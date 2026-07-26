# cooking

`cook` raw food into something safe to eat — and, for food that opts in, into
something *good*.

## The shared `cook` verb

`cook` means two things in this game: food on a stove, and drugs in a chem lab
(plugins/synthesis). This plugin owns the verb and routes; synthesis is reached
through the **`synthesis.cook` Action**, not an import, so neither plugin depends
on the other loading.

Routing is **target-first**:

- naming something you're carrying that can be cooked (`needs_cooking` / `vessel`) → food
- anything else → a synthesis recipe, and synthesis reports on it far better than we could
- `synthesize <recipe>` always means drugs, whatever else is in the room

The one genuinely ambiguous input is a bare `cook` in a room holding **both** a
stove and a chem lab. That gets a **SIFT** station prompt, like any other
ambiguous target in the game — the pick replays through the
`cooking.station_choice` Action (plugin verbs must never replay via `{ verb }`;
that route only reaches engine builtins).

`heat` — the old food verb, from when synthesis owned `cook` outright — survives
as a plain alias in `ALIAS_DEFAULTS`.

## The two tiers

**Plain food** (`tags.needs_cooking`, no profile) works exactly as it always
has: `cook` it, wait, it's cooked. Binary. Nothing below applies to it.

**Profiled food** (`tags.food_profile`) opts into depth:

```
stow steak in pan     (existing container verb — no cooking code involved)
cook pan              (the pan and everything in it goes on the stove)
flip steak            (needs a tags.can_turn tool carried uncontained)
plate steak           (ends it, decides quality, awards Cooking IP)
eat steak             (restores scale by the band)
```

Leave it on the heat and it burns. That's not a failure state you have to opt
into — it's what happens if you walk away.

## The third tier: dishes

Put several ingredients in a vessel and they stop being several things.

```
add raw meat in pot        (`add`/`put`/`stow` — the ordinary container verb)
add potato in pot
add soup base in pot
cook pot
stir pot
plate pot                  →  "meat and potato stew"
```

There is no `combine` verb and no recipe-selection step. The vessel **is** the
combining interface — it already held several items and already went on the heat
as a unit. All that changed is that `plate <vessel>` now resolves the whole thing
into one dish instead of handing back its contents individually.

### Matching is on profiles, never on item ids

A dish template asks for *one liquid, one dense meat, one-to-three starchy
vegetables, in a pot*. It never names an item. Consequences:

- 60 ingredients across 10 profiles produce **44 dishes** from one mechanic.
- Tag a new root vegetable and it is stew-legal instantly — no catalog edit.
- The dish's **name** derives from what actually went in, so the same template
  yields "meat and potato stew" and "fish and root stew" for free.

`needs` is a count or `[min,max]`; `optional` lets fat and aromatics ride along;
a profile that is neither needed nor optional **fails the match** — you cannot
smuggle a pancake into a stew. Ties are impossible: the template requiring more
wins, and regress sweeps every signature to prove no two ever score equal.

Unmatched combinations still cook. They resolve to slop capped at `acceptable`,
which is the failure mode that teaches the system without the catalog having to
enumerate every bad idea.

Quality composes: each ingredient is scored by the normal timeline, then the
dish takes the mean pulled toward the worst (`WORST_PULL`), clamped to the
template's ceiling. One mediocre potato dents a stew; it doesn't sink it.

All 44 dishes share **one** content item (`item_cooked_dish`) — the bespoke name
rides on `custom_data.name`, which the inventory renderer already prefers.

## Modifiers

Two profiles are marked `modifier: true` — `fat_or_oil` and `aromatic`. They
season a dish rather than being part of it, and the distinction is mechanical:

- they never take a cook session, so they can **never burn away** while the main
  is still going;
- they are never scored and contribute **no band** to the composition;
- each one present adds a flat `MODIFIER_BONUS` to the finished dish, capped at
  `MODIFIER_BONUS_CAP`;
- they still count toward the dish MATCH (a sear genuinely requires fat) and are
  still consumed.

This is not cosmetic. Cook time scales with `weight × cookRateMult`, and a bulb
of garlic is light with a tiny rate multiplier — as a scored ingredient it was
cinders about twenty seconds before a roast was ready, which made every dish that
"optionally" allowed aromatics strictly worse for having them. Modifiers are the
fix, and they are why `optional` means what the line above claims.

## Staging, burner control, seasoning

**Staging.** `cook <vessel>` again after adding something puts the NEW ingredient
on the same burner the vessel already occupies. This is not a convenience — cook
time scales with `weight × cookRateMult`, so a 500g broth and a 100g leaf started
together have *no instant at which both are good*. Staging is the only way most
pot dishes are cookable at all: start the broth, add the greens ~3 minutes in,
and their windows land on top of each other.

**Burner control.** `stove <low|mid|high>` rides the heat. A stove's
`stove_tier` is its CEILING, not its only setting: a range can be turned down, a
hotplate cannot be turned up. Each change appends to a `heats` log on every live
session on that burner.

A profile may declare a `heatCurve` instead of relying on `heatTolerance` alone —
`dense_meat` wants high for the first quarter then low; `liquid` wants a hard
start then a simmer. The score is the fraction of the cook spent at the setting
the food wanted *at that moment*, so searing then dropping beats any flat tier,
and a tier the curve never asks for scores worst. `heatTolerance` must equal the
curve's dominant phase (`validateProfiles` enforces it) so the leave-it-alone
answer and the curve never disagree about the same food.

The deliberate cheat: the burner changes QUALITY, not cook RATE. A varying rate
would mean integrating a piecewise clock to answer "when is this done", and the
whole architecture rests on `doneAt` being one stored timestamp.

**Seasoning.** Modifiers pay up to the dish's ideal and cost past it. The ideal
derives from the recipe — a curry that REQUIRES two aromatics wants two, so
following the recipe can never read as over-seasoning. Under-seasoning is a
missed bonus (bland); over-seasoning is an active penalty, and a heavier one
than the bonus it replaces, so "add everything" is never the safe play.

## The cookbook

Knowing a recipe **never gates cooking it**. Any combination always cooks; the
cookbook is a record and a small edge (`KNOWN_RECIPE_BONUS`, a sub-band nudge),
not a permission system. That is what keeps discovery alive — a player who has
never heard of a chowder can still make one, and doing so is what writes it down.

Three ways in:

| Path | How | Pays |
|---|---|---|
| Discovery | plate the same combination at **good or better, 3 times** | `DISCOVERY_IP` |
| Recipe card | `read` an item tagged `recipe_card: <key>` | — |
| NPC taught | a dialogue node fires the `TEACH_RECIPE` Action | — |

Discovery is by REPETITION, not luck: one good plate proves nothing, and a plate
below `DISCOVERY_MIN_BAND` teaches you nothing at all, so you cannot stumble into
a recipe by ruining it three times. Cards and NPCs still teach instantly.

Storage is one `player_flags` row per known dish (`cookbook:<key>`) holding the
best band ever achieved, plus a transient `cookprog:<key>` tally while you are
still learning it — cleared the moment it is written down. No new `players`
column, no new table. A recipe learned on paper stores `untried` until you
actually cook it.

The **Cookbook** tablet app (`plugins/tablet/cookbook-app.js`) reads it. It shows
what you know and a bare count of what you don't — the undiscovered half is
deliberately blank, because a checklist of exact ingredient counts would turn
discovery into data entry.

## Files

| File | Holds |
|---|---|
| `index.js` | the `cook` router, `plate` (single + vessel), `read` on recipe cards |
| `interact.js` | `flip` / `stir` — one function, two verbs |
| `cook.js` | sessions, timers, boot catch-up, burn-off |
| `quality.js` | **pure** timeline + scoring. No DB, no clock of its own |
| `profiles.js` | the ingredient-class catalog + `validateProfiles()` |
| `dishes.js` | the dish catalog, signature matcher, naming, `validateDishes()` |
| `knowledge.js` | the cookbook: what's known, how it's learned, `TEACH_RECIPE` |
| `config.js` | every balance number in the system |

## No tick, no polling

A session is a timestamp blob on the food's own `player_inventory.custom_data.cooking`:

```js
{ applianceId, startedAt, thawMs, cookMs, doneAt,     // plain
  profile, heatTier, vessel: {d,r}, acts: [] }        // profiled only
```

Everything else — the peak window, the burn point, the current stage, the final
band — is *derived* from those numbers and `now`, at the moment somebody asks.
Examining a cooking steak writes nothing. Twenty examines and one examine produce
the same answer (there's a regress case asserting exactly that).

DB writes per cook: **one** on `cook`, **one** per `flip`/`stir`, **one** on
`plate`. That's the whole budget.

A bounded set of `setTimeout`s narrate the stage beats and fire the burn-off;
they're pure narration and are rebuilt from `startedAt` by the boot-catchup IIFE
at the bottom of `cook.js`, the same way jail rebuilds release timers. Losing
them loses flavour text, never state.

## Quality

Each profile maps an end state to the best band it can reach:

```js
targets: { raw: 'good', peak: 'masterful', over: 'acceptable', burnt: 'poor' }
```

That's a **ceiling**. A tomato is excellent raw *and* cooked; a potato raw is
poor however carefully you didn't cook it. The process — heat tier vs. the
profile's tolerance, vessel, how many times you turned it and when, how centred
in the window you plated it, and a `cooking` skill check — decides how far below
that ceiling you land. Nothing can push you above it.

The band lands on `custom_data.cook_quality` and is spent in exactly one place:
`applyItemUse` in `server/engine/commands/inventory.js`, where it scales
`restore_hp`/`restore_hunger` (poor 0.5× → masterful 1.6×, acceptable exactly
1.0×). Absent ⇒ 1.0, so nothing that predates this changed.

`cook_quality` is in `INSTANCE_KEYS` — a Masterful steak must never stack-merge
into a Poor one.

## Adding a food

Tag it. That's the whole procedure:

```json
{ "needs_cooking": true, "food_profile": "dense_meat", "food_noun": "beef" }
```

It immediately works in every dish `dense_meat` appears in. `food_noun` is
optional — without it the item name is used, minus state words (`raw`, `fresh`,
`frozen`, `dried`) — but set it when the name reads badly in a dish ("fresh
catch" would otherwise give you "catch and potato stew").

Adding a *new profile* means one entry in `PROFILES` and nothing else — no new
code path, no new verb, no table. Adding a *new dish* means one entry in
`DISHES`. Both validators are asserted by regress: `validateProfiles()` rejects a
peak worse than raw or burnt beating overcooked; `validateDishes()` rejects
unknown profiles, empty requirements, bad ranges, and two templates that demand
the same thing in the same vessel (one would be unreachable).

## Balance

All of it lives in `config.js`. `BASE_OFFSET` is the one to reach for first — it's
how far below the ceiling every cook starts, and therefore how hard the top bands
are to reach.
