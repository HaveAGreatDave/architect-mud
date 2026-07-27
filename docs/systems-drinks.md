# Drinks & Drinkware — as built

Mixology and hot drinks, in a vessel you keep. Plus the **dish cabinet**, which
is the reason you no longer carry a stock pot into a gunfight.

**STATUS: BUILT.** Plugin `plugins/drinks/`, content shipped, regress green.
Tone authority is [story.md](story.md).

Not to be confused with [systems-survival.md](systems-survival.md), which owns
thirst itself — this is what you drink, not what drinking does to you.

## Why it exists

The game had 14 alcoholic cocktails, four soft drinks, one bowl and no cups. You
could not make a drink; every cocktail was a pre-authored item bought from a
bartender. Two items (`item_rail_highball`, `item_synth_champagne`) read as booze
in their prose and carried no `laced_drug`, so they were accidentally soft drinks.

## The one decision everything follows from

**A finished drink lives on the vessel's `player_inventory.custom_data`, not as
a new item row.** A row would consume the vessel, and the whole point of
drinkware is that you carry it, drink it down, and still have a cup.

```jsonc
{
  "mixing": [ { "item_id":"item_gin", "profile":"base_spirit", "pours":1, "abv":0.4, "band":"excellent" } ],
  "drink":  { "key":"negroni", "name":"negroni", "band":"excellent",
              "servings":3, "capacity":3, "thirst":18, "sanity":6,
              "potency":1.4, "hot_at":null, "made_at":..., "contaminated":false },
  "dirty": true,
  "residue": "coffee_base"
}
```

`plugins/drinks/vessel.js` is the **only** module that reads or writes that
shape. **The invariant:** a vessel holds either fillable's plain fluid or our
`drink`, never both — which is why `FLUID_RATES` never had to learn about
anything but water.

**No new columns, no new tables, no tick.** Hot→cold is derived from `hot_at`
at drink time, exactly as cooking derives resting from `plated_at`.

## Verbs

| Verb | Does |
|---|---|
| `mix <thing> into <vessel>` | add an ingredient to the build |
| `mix <vessel>` | resolve the build into a drink (cold) |
| `brew <vessel>` | the same at a `brew_tier` appliance; stamps it hot |
| `drink <vessel>` | one serving, over the 12s sip sequence |
| `pour <a> into <b>` | decant (see below) |
| `rinse <vessel>` | clean it at a sink |
| `recipes` / `recipes <name>` | the catalogue, and a real recipe card |

Cold mixing is **ungated** — a vessel in hand is the whole requirement. Hot
drinks need furniture, mirroring `cook`'s `stove_tier` gate.

## Tags

| Tag | Meaning |
|---|---|
| `drink_profile` | the class-match axis — `base_spirit`, `mixer`, `juice`, `tea_base`, … |
| `pour_units` | how many 25ml measures one row is (a 700ml bottle = 14) |
| `abv` | percent alcohol **of this ingredient** — the only alcohol figure ever authored |
| `drink_noun` | the word it lends to a derived name |
| `drinkware` + `drinkware_kind` | a reusable vessel, and which kind |
| `fillable` | doubles as **capacity in servings** — one number, so a mug can't disagree with itself |
| `insulated` | thermos; stretches the cooling curve |
| `fragile` | **authored, not yet read** — no drop/break seam exists |
| `dishware` + `dishware_kind` | plates and strainers: kit with no mechanics, deliberately **not** `vessel` so nobody can cook a dinner plate |

Furniture: **`brew_tier`** ∈ `kettle` · `machine` · `barista`, each a band bonus
and a hard ceiling (a kettle can never pull espresso). Powered tiers check
`isPluggedIn`.

## Matching and quality

`plugins/drinks/recipes.js` is `dishes.js`'s architecture with two deliberate
differences:

- **`vessels` is a LIST**, not a scalar — a negroni is a tumbler *or* a glass; a
  stew is only ever a pot. Drinkware is genuinely interchangeable.
- **Units are POURS, not grams.** Nothing in this plugin weighs anything.

Everything else survives: `needs` ranges, `optional`, the allowed-profile
disqualifier, specificity tiebreak, `keyItems` + `KEY_DRINK_FLOOR` for named
classics, and `composeBand` (mean pulled toward worst, clamped to ceiling).

Three profile kinds:
- **ordinary** — composes the band.
- **modifier** (`syrup`, `bitters`, `garnish`) — seasons rather than composes;
  measured in dashes, never millilitres.
- **medium** (`hot_water`, `ice`) — fills the glass but has no quality worth
  scoring. Nobody has praised a cup of tea for its water. Without this, hot
  water dragged excellent leaves down to a mediocre cup.

`GENERIC_MIXED` is the always-available fallback (`optional: null` means "allows
anything"): one spirit and one mixer is **always** a real drink, named off its
parts, and teaches nothing — pouring rum into cola is not a discovery.

## Alcohol is derived, never authored

```
ethanolMl = Σ (pours × 25ml × abv)
potency   = clamp(ethanolMl / 10ml, 0.4, 3.0)
```

Tag a new bottle with an `abv` and every recipe it fits gets the right strength
that instant. **`potency === 0` applies no drug at all** — a cup of tea can never
make anyone tipsy through a rounding error.

Dilution falls out of the arithmetic rather than needing a rule: ice and mixers
add volume and zero ethanol, so a long drink is genuinely weaker per mouthful.

A serving applies `potency / capacity` through
**`useDrug(player, 'drug_alcohol', { potencyMult, skipInstant: true })`** — the
identical call `applyItemUse` makes at [inventory.js:763](../server/engine/commands/inventory.js:763),
so intox, phases, tolerance and overdose behave exactly as for a bottled
cocktail. Nothing here reimplements being drunk.

## Drinking, and the consume interop

`drink <mug>` dispatches `consume.begin` with a **new `itemKind: 'vessel'`**, so
the whole existing 12-second sip sequence is reused verbatim. At the end, the
vessel finisher is **not** `finishConsumeItem` (which deletes the row) but the
`drinks.finishServing` action, which re-queries fresh, decrements one serving,
and leaves you holding a dirty cup.

`plugins/consume` gained a **vessel line pool**. Not cosmetic: `CONFIG.drink.start`
reads *"you crack the cap off with a hiss"*, which is a visible bug over a mug of
tea. You knock back a can; you nurse a mug.

⚠ **A vessel drink never passes through `applyItemUse`**, so it inherits none of
`well_fed`, `restore_hp`, freshness, or the `item.consumed` hook. `finishServing`
implements thirst, sanity and alcohol only. Anything added to `applyItemUse`
later will silently not apply to drinks.

## Decanting

`pour <a> into <b>` moves servings, clamped by B's capacity.

- **Same drink → merges**, band recomputed as the servings-weighted mean, so
  topping a great cocktail up with a bad one drags it down.
- **Different drinks → both become `UNKNOWN_DRINK`.** The catalogue's own
  fallback does the work; no special case.
- **Hot into cold takes the OLDER `hot_at`** — you can't refresh a cold coffee
  by decanting it.

## Load order is load-bearing

Specialized actions fire in **registration order**, which is alphabetical, so
`drinks` claims `drink` before `fillable` — a cup holding a poured drink must
not be treated as plain water. A folder rename would break this silently, so the
belt to those braces is the `holdsDrink()` guard inside
[plugins/fillable/index.js](../plugins/fillable/index.js), which doesn't depend
on ordering. Both are asserted by regress.

## The dish cabinet

Cooking resolved its pan strictly from top-level inventory, so a kitchen you own
couldn't hold its own pots. There is exactly **one choke point**:
[`resolveInventoryItem`](../server/engine/inventory.js:65), which gained an
opt-in **`fromNearby`**: on a MISS only, widen to furniture in the zone with
`object_type='container'` and `flags.dish_cabinet`.

No new storage — furniture containers already keep their contents as ordinary
`player_inventory` rows keyed by `container_id`. **One extra round trip, only on
miss**, so no hot path pays for it. Cooking and drinks opt in for
vessel/tool/drinkware lookups; nothing else does, so wardrobes and vendor stock
are untouched.

The item is **used in place and never moved into your pack**, and the pull is
narrated once (*"You take the cast-iron skillet down from the dish rack"*) rather
than a pot appearing from nowhere.

## Kitchen kit: rewarded, never required

Every piece of kit this build added follows one rule — **it makes an act better,
it never makes the act possible.** The house pattern (a mop for cleaning, soap
for a rinse) applies, and it applies hardest to the verbs that *end* something,
because gating those strands a player mid-task.

| Kit | Without it | With it |
|---|---|---|
| **colander** (`dishware_kind: strainer`) | `drain` works — with the pan lid and your nerve, at **−1 band** | clean, no loss |
| **dinner plate** (`dishware_kind: plate`) | `plate` works, zero bonus — you eat off a **paper plate** | small band bonus + a line |
| **serving platter** | as above | a bigger bonus, but **only** on a dish of 3+ components — one fried egg on a platter is a joke, and it quietly falls back to plate money |
| **dish cabinet** | carry your own pans | the room's kit is reachable |
| **thermos** (`insulated`) | a mug goes cold on the normal curve | the curve stretches |
| **shaker** | shaken templates are unreachable | the `shaken` bonus |

**`plate` has never required a plate and still doesn't.** It's the verb that
ends a cook: `plate <vessel>` resolves a pan, `plate <food>` takes a lone cut
straight off the heat, and unprofiled food just comes off when it's done. A
player with no dishware still gets zero bonus — regress pins that as a **zero,
never a refusal** — but they don't get silence. **They eat off a paper plate**,
from a rotated pool of lines about plates that go soft under the food, bow in
the middle, and come off a stack somebody else bought.

That distinction is the whole design of the fallback, and regress asserts it in
both directions: the line must **characterise** (it says paper plate) and must
**never instruct** (no "you should", no "buy", no "you need a"). Being too poor
for crockery is a fact about the cook, and it's funny. Being told to go shopping
by your own kitchen is nagging about a thing you don't own.

There is deliberately **no `item_paper_plate`**. Making the fallback a consumable
would make real plates required through the back door — the exact thing this rule
exists to prevent — so the paper plates are an implied, inexhaustible supply of
grim disposables and always will be.

Burnt food gets no flourish either. Nothing about a nice plate rescues a ruined
pan, and pretending otherwise would read as the game taking the piss.

## `drain` — and the profile that made it necessary

`drain <vessel>` takes wet starch off the heat wherever it is in its window,
which is the point: *"drain it short of done and finish it in the sauce"* is a
real technique, and the penne recipe was instructing players to do something the
game had no verb for. Drained starch stays **finishable** (the same
`stayFinishable` seam a browned component uses), so it can go on into the pan and
`plate` still resolves the meal.

It exists because **`dry_starch`** does. Pasta, rice, noodles and dried pulses
were all riding `starchy_vegetable`, whose `needsPrep: true` means *"arrives
whole, cut it down first"* — so the game was asking players to **chop dry pasta
with a knife**, and the recipe card printed *"250g of starchy vegetable, cut
down"* for a box of penne. The new profile has the right physics: no knife work,
inedible raw (a raw potato is merely poor; dry pasta is not food), a narrow
window between al dente and paste, nearly unburnable while there's water around
it, and **`turns: 0`** — stirring rice is how you get wallpaper paste. It has its
own narration too: dry starch doesn't brown, it swells and clouds the water. The
five items carry `food_also: starchy_vegetable`, so every existing recipe that
wanted a starch still matches.

## Recipe cards

Both catalogues render **real** recipes, from the same templates the matcher and
the clock use — so a card can never promise something the pan won't do.

- **Drinks** (`recipes <name>`, tablet **Bar** app): measures converted from
  pours at 25 ml — *"2 measures (50ml) of spirit"*; modifiers as dashes; method
  (Built / Stirred / Shaken / Brewed) **derived** from the template's own flags.
- **Cooking** (`cookbook <dish>`, tablet **Cookbook** app): weights from each
  profile's `unitWeight` — *"250g–500g of dense meat, cut down"* — a timing
  estimate from its cook rate, and a method built out of its heat curve, turns
  and doneness levels.

The two apps differ on one point, deliberately. **Cooking hides what you haven't
discovered** — working out that meat plus liquid plus potato is a stew *is* the
cooking game. **Drinks are fully browsable**, because a negroni is public
knowledge and pretending a bartender must reverse-engineer one would be tedious
rather than mysterious. The drinks skill is in pouring it *well*.

Both use the **`cooking` skill**. A career bartender levels Cooking; adding a
`mixology` skill is a `SKILLS` const change (an engine rebuild), and
plugins-over-engine said reuse.

## NPC home life

`plugins/ambient-life/home-life.js`. An NPC who is **in their `home_zone` and
off-shift** makes something, consumes it, and clears up — three or four narrated
beats toward a picked outcome.

**It is not a simulation, and that's the design.** The NPC holds no vessel, runs
no cook clock, resolves no recipe and writes no rows. Nouns come off the live
`DISHES` and `DRINKS` catalogues, so a recipe authored for players shows up in
NPC life the same day with no edit. One routine per zone; a witness is required
and re-checked every beat; `flags.no_home_life` opts an NPC out.

## Content

57 items and 12 furniture. Drinkware (11), bases/mixers (18), a plain
non-alcoholic roster (18: cold brew, iced tea, four juices, six sodas, malt
shake, kefir, horchata, chicory, electrolytes), cookware and dishware (10),
brew appliances (6) and dish cabinets (6).

**Every soft drink also carries `drink_profile` + `pour_units`**, so it doubles
as a mixer. That is the whole reason the roster and the mixology system landed
together rather than separately.

## Known gaps

- **`fragile` is authored but unread.** `player_inventory.condition` exists but
  nothing decrements it for a dropped cup. Tagged now so nothing needs
  backfilling later.
- **Vendors cannot hand you a filled vessel.** `vending`/`vendor.js` insert item
  rows, which have no path to `custom_data.drink`. Bought drinks stay ordinary
  consumables; vessels are strictly the player-made case.
*(The two mis-tagged items are fixed: both now carry `laced_drug: drug_alcohol`
plus a potency and an `abv`, so their prose and their mechanics finally agree,
and both work as ingredients.)*
