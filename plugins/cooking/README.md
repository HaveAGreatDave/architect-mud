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
score steak           (optional prep — see below; every one of them is a trade)
stow steak in pan     (existing container verb — no cooking code involved)
cook pan              (the pan and everything in it goes on the stove)
flip steak            (needs a tags.can_turn tool carried uncontained)
taste steak           (what it tells you scales with Cooking skill)
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

### An ingredient can be two things — `food_also`

Milk is a liquid *and* a dairy. The profile itself has to stay singular, because
it drives a **clock**: one timeline, one set of stage prose, one set of targets,
and milk behaves like a liquid in a pan whatever else it is. But "what is this
made of" and "what does this satisfy in a recipe" are different questions, and
only the first needs one answer.

So `tags.food_also` declares a **secondary identity** that rides in its own
channel (a `Symbol` key on the signature, invisible to `Object.keys`):

| | drives the cook clock | can satisfy `needs` | can fail the allowed check |
|---|---|---|---|
| `food_profile` | ✅ | ✅ | ✅ |
| `food_also` | ❌ | ✅ | ❌ |

**That asymmetry is the whole design.** A secondary can only ever *help* a match,
never break one — so tagging milk as dairy cannot stop it matching `mash` or
`porridge`, which take a liquid and have no opinion about dairy. Without it, the
tag would silently break every existing recipe milk appears in.

It cuts the other way too: milk is still a liquid, and bread doesn't take
liquids, so pouring milk on bread is not a cheese sandwich. Being *also* dairy
doesn't stop it being *actually* a liquid.

A secondary contributes the same unit count as the primary — a 400g carton is one
liquid, so it's one dairy. Recounting it against cheese's 90g unit would make it
4.4 dairy and blow every range in the catalog.

`buttered` rides the same channel: buttered bread satisfies a fat requirement
without a separate pat of butter being an ingredient in the pan.

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

Unmatched combinations still cook — and they are no longer slop. `inferDish`
names them off a family table (see **Improvised dishes** below); slop is now what
you get for putting something that isn't food in the pan.

Quality composes: each ingredient is scored by the normal timeline, then the
dish takes the mean pulled toward the worst (`WORST_PULL`), clamped to the
template's ceiling. One mediocre potato dents a stew; it doesn't sink it.

All 44 dishes share **one** content item (`item_cooked_dish`) — the bespoke name
rides on `custom_data.name`, which the inventory renderer already prefers.

## Sandwiches: the one open-ended dish

Bread is a **vessel**, the same way a bowl is — a thing you assemble in. Two
things make it different from every other vessel:

**It's edible** (`tags.edible_vessel`). A sandwich is not fillings served in a
bread container; it *is* the bread. So the bread is scored as an ingredient,
lends its noun to the name, and is consumed by `plate`. Every other vessel is
equipment and survives the meal.

**It never makes slop** — and it was the first vessel that didn't. An unmatched
bread vessel falls to `GENERIC_SANDWICH`, which names itself from its contents:

```
stow rat haunch in flatbread
stow onion in flatbread
plate flatbread            →  "rat meat and onion sandwich"
```

No recipe for that exists, and making it **creates none** — the generic template
carries no `key`, and `plate` only records a discovery when the match came back
with one. That was once what made the sandwich unique; it is now how every
improvised dish behaves, and player recipes are where those get written down. Named sandwiches (`cheese_sandwich`, `club`) are ordinary
`DISHES` entries with `vessel: 'bread'` and beat the generic on the normal
specificity rule, so a recipe always wins where one exists.

Bread can also go **on the heat** — `cook flatbread` toasts the bread *and* its
fillings, because an edible vessel joins its own cook as an ingredient. Cold, its
ingredients are scored at their raw targets like a bowl's.

### `bread` is its own profile

It used to be tagged `starchy_vegetable`, whose raw target is `poor` — correct for
a potato, disastrous for a sandwich, since every cold sandwich would have been
dragged down by its own bread. Bread arrives baked: `raw: 'good'`, better toasted,
and past that it's burnt toast. It also stops turning up in stews.

### `butter <bread>`

The one prep that's also an ingredient. Buttered food **counts as the dish's fat**
in the signature and pays a small flat bonus on top, so buttered bread plus cheese
in a pan is a toastie with no second pat of butter going in — which is how anyone
actually makes one. Takes a quarter of the block per spread; only the last quarter
takes the item.

### `cut`

`cut` is `chop` — nobody chops a sandwich in half — and it works on **finished
dishes** as well as raw ingredients. A plated dish carries no `food_profile` (all
48 share one item id), so it's recognised by its `cook_quality`/`dish` stamp
instead. The portion arithmetic is identical, so two halves of a sandwich feed you
exactly one sandwich. Cutting a raw ingredient changes how it cooks; cutting a
finished dish just shares it, and the message says so.

## Improvised dishes — food makes a dish, non-food makes a mess

The catalog answers 47 combinations. Everything else used to fall to
`UNKNOWN_DISH` — "a mess", capped at `acceptable` — which was right when the
alternative was enumerating every bad idea, and stayed right for exactly one
vessel. Bread already had the better answer: put anything sensible between two
slices and you have made a real thing, so name it what it is.

`improvised.js` generalises that to every vessel. A pot of stock, rat and turnips
with no template behind it is not a mess; it's a **turnip and rat stew**. The
rule that replaced "unmatched ⇒ slop" is one line:

> **Food makes a dish. Non-food makes a mess.**

So the only remaining route to slop is putting something with no `food_profile`
in the pan — motor oil, mutagen, a spanner. That pot really is incoherent and
deserves the old answer. Anything made of actual ingredients gets a name.

## What an ingredient carries onto the plate (`hazards.js`)

**A name is not the same as a consequence.** Plating produces one generic
`item_cooked_dish` row, so the eat path in `commands/inventory.js` was reading
the tags of a *generic dish* — and every property of everything in the pan was
thrown away. A stew of rat, mutagen and a measure of filth ate exactly like a
stew of rat. That also made the tag catalog wrong in writing: `bodily_filth`
claimed it "taints the whole dish… carries the filth through to the plate", and
nothing did that.

`gatherHazards` runs at plate time and stamps `custom_data.hazards`. **This is
independent of quality** — a mess and a `superb` improvisation carry their
ingredients identically, because being good at cooking is not the same as the
pan being safe.

| Carried | How it merges | Why |
|---|---|---|
| `status_chance` | **worst**, per effect | Two risky things don't make a safer dish, and summing sails past 1.0 |
| `disease_risk` + `donors` | any / union | The donor id `depositIntoVessel` stamps is the only reason disease risk is more than flavour |
| `radiation`, `sanity` | **summed** | Dose-like. Two irradiated fillets really are two doses |
| `laced_drug` | first wins | The drug path takes one id; picking a winner beats silently dropping one |

Two rules worth not breaking:

- **Cooking changes how good a thing is, never what it IS.** Heat is not a
  purifier here — hazards carry at full strength. A well-cooked filth stew being
  safe would be the joke collapsing.
- **An intermediate cannot launder a pan.** `gatherHazards` reads each row's own
  carried `hazards` as well as its tags, so filth folded into a paste and the
  paste folded into a pie is still a filth pie. Without that, one intermediate
  step washed everything clean.

**Families**, ordered most specific first per vessel kind, first match wins:
curry beats chowder beats stew beats soup beats broth in a pot; pie beats bake
beats gratin beats roast in a tray; hash, scramble, sauce, sear, saute in a pan;
salad, mash, dip in a bowl; grill on a bare stove. A family declares its `lead`
— the profile whose noun goes in front — which is what makes it "beef stew" and
"apple pie" rather than a list of contents. A dish is named after the thing it is
mostly *of*.

### Why this doesn't kill discovery

An improvised dish is capped **below** an authored one. Its ceiling climbs with
complexity — the number of *different* profiles you balanced, modifiers excluded,
so piling in five potatoes buys nothing — and stops at `superb`. **`masterful` is
reachable only through a recipe somebody wrote down.** On top of that,
`RECIPE_MASTERY_IP` pays a flat bonus for plating a recipe you *know* at
`excellent` or better, comfortably more than the most complex improvisation
earns. Inventing is worth something; knowing the real thing is worth more.

Complexity also raises `difficulty`, so a rich improvisation is a genuine risk
rather than a free ceiling.

## Player recipes — the half of the cookbook you write yourself

An improvised dish carries `custom_data.improv`: its **signature**, the multiset
of profiles that made it rounded to whole units, plus the vessel. That string is
the recipe's identity. Hold the plate and `recipe save <name>` writes it down.

```
recipe                          what you've written down
recipe save <name>              from the dish in your hands
recipe rename <a> to <b>        free — the signature is the identity, the name is a label
recipe forget <name>
recipe write <name>             copy it onto a card (an ordinary, tradeable object)
recipe teach <name> to <who>    for when they're standing right there
```

Storage is one `player_flags` row per recipe, `recipe:<slug>`, holding a small
JSON blob — the same shape `cookbook:<key>` already uses. No new table, no new
`players` column.

Three things follow from identity being the **signature** and not the name:

- **Renaming is free and breaks nothing.** Two players can call the same pot
  different things and both matches still fire.
- **Saving the same combination twice is refused**, by signature. A second name
  for one pot would be two recipes that can never be told apart, and the second
  would silently never match.
- **Seasoning isn't part of it.** A stew you salted and one you didn't are the
  same recipe, so a saved one matches both.

Cooking a pot you've written down uses **your** name for it and pays the same
`KNOWN_RECIPE_BONUS` the authored cookbook does. That is the whole reward for
writing one down: the game starts calling your invention what you call it, for
you and for anyone you taught.

**Sharing is two shapes on purpose.** A card (`item_written_recipe`, one blank
for every recipe anybody ever invents — the same trick that has 48 dishes share
`item_cooked_dish`) is an *object*: sellable, findable on a corpse, leavable on a
table, and it travels through the trade system that already exists. `teach` is
what you do when the other person is right there and neither of you has a pen.
The **author travels with it** either way, so a recipe three players deep still
says whose it was.

## The shopping list

A recipe's shortfall was already computed in three places and none of it survived
leaving the room, so the actual workflow — read what you're missing, walk to the
market, try to remember it — happened in the player's head.

```
shoplist                    the list, answered
shoplist add <recipe>       writes down what you're SHORT of, not the whole recipe
shoplist tidy               crosses off what you've since got
shoplist drop <n>           one line, by the number printed beside it
shoplist drop <recipe>      the whole dish — every line that was added with it
shoplist clear
```

`add` takes a recipe, so `drop` does too: a number is a line and a name is a
dish. The kit needs no special handling either way — it is derived from the
`for` labels still on the list, so the pot leaves with the last dish that
wanted it and stays while another one does.

> **The list stores what you WANT, never what you have.**

Whether a line is ticked is **derived at read time** from your inventory. So
nothing fires when you buy something, there is no "mark as bought" step, and the
list cannot go stale — buying the onion ticks the box because the box is a
question, not a record. (A finished dish never counts: buying dinner doesn't
cross "one soft vegetable" off.)

Entries are ingredient **classes** (`{k:'p', v:'soft_vegetable', n:1}`) rather
than item ids, because that's what a recipe actually asks for. That is also what
makes the other half work: the **`shop.stock` hook** marks vendor stock that's on
your list and still outstanding, so "one soft vegetable" lights up whatever this
particular shop happens to stock, with no authored mapping anywhere. A keyed
dish's anchor is the exception and goes on by item id.

The **`container.view` hook** marks the same thing inside a box — a shop's
chiller case, its kitchenware rack, your own fridge. Half a shop's stock is
reached by opening the case rather than by talking to the clerk, and a shelf you
have to hold the list up against yourself is only half a list wherever you're
standing when you read it. Same caret, same yellow, one `markRow`.

A box is a place you take things **out** of, though, so the container mark also
carries **how many** (`wantedQty`). The panel's take-listed button pulls that
amount — the shortfall in the recipe's own units, so 500g of dense meat is two
250g fillets — never one and never the whole stack; a shelf of five tomatoes
must not empty itself for a soup that wants one. The shortfall is **spent as it
is allocated, across both boxes of a paired appliance**, so the fridge and the
freezer can't each claim it and send you home with six. A row that answers
nothing outstanding any more loses its caret entirely: a mark you shouldn't act
on is worse than no mark. The button itself sits **above every section** and
covers all of them — sections are how a list reads, not how a shopping trip
works — with the per-section buttons kept for the trip where you only want the
cold half of it.

A class entry is **labelled with things you can actually buy** (`buyableExamples`
in `shoplist.js`), and every noun it names is one the entry will ACCEPT — the
test is `food_profile` exactly, the field the matcher itself reads. This is why
the recipe-card **note is suppressed on the list** when examples replace it: a
note is written for the cook and can name something the shop's shelf won't
answer. The note still orders the examples (whatever it mentions first is
offered first); it just doesn't get the last word on what counts. A class the
dish has its own word for — `nouns`, or a single-unit key item — prints that
word instead and is left alone. A class the dish has **narrowed** with `requires`
(below) is swept differently again: only nouns answering that requirement are
offered, and the sweep looks at `food_also` as well as `food_profile`, because
the tin of tomatoes is a `liquid` and the tomato in the sauce is exactly that
secondary identity.

### `requires` — a class the dish means one thing by

`nouns` says what a generic class stands for in one particular dish, so the card
reads "a tomato" rather than "one soft vegetable". It was **display only**, and
the matcher went on accepting any member of the class: a pan of penne, gin and
lamp-grown greens plated as **penne alla gin**, with the card printing "a tomato"
over the top of it.

`requires: { soft_vegetable: 'tomato' }` is the **binding half of the same
statement**. The class still does the counting — weight, tolerance and units are
untouched — but something in it has to answer to that name, matched as a
substring in both directions against `food_noun` and the item's own name, so
"tinned tomatoes" and "tomato paste" both pass without the catalog having to
agree on a singular. It is filed under the class the noun *answers*, primary or
`food_also` alike.

Why not `keyItems`: a key item is an exact id and all of them are mandatory, so
naming the tin would forbid the tube and the fresh one. **The noun is the level
the requirement actually lives at** — it is tomato, however it's sold.

**Mac and cheese is the case where `requires` carries the anchor on its own.**
It has no key items at all: `requires: { dry_starch: 'macaroni', dairy: 'cheese' }` is the
whole identity of the dish, because both halves of the name are things the world
sells under more than one label, and a key item would pin each of them to one row.
It is what makes a tray of penne, cream, egg and butter fall through to something
else, which is correct: the classes alone would have called it mac and cheese.

It is **opt-in per dish and deliberately not derived from `nouns`**. Half the
catalog's `nouns` name a thing no item carries at all ("stock", "meatballs") and
could never be a rule, and promoting the rest would make eight dishes stricter as
a side effect of what the item catalog happens to contain that day. A requirement
is something an author states. `validateDishes` checks a `requires` entry narrows
a class the dish actually needs, and that `nouns` and `requires` agree — the card
naming one thing while the matcher demands another is the exact failure this
field exists to end.

The planner (`pickFor`), the Assistant's readiness score and the shopping list
all read the same field, so none of them can hand you, highlight or send you
shopping for the ingredient that guarantees the pan won't match.

### The list nests, three deep

A flat run of ingredients with "for penne alla gin" repeated down the side reads
as one shopping decision when it is four, so the list is **grouped under the
recipe that wanted each line** (in the verb and in the Cookbook app alike). Under
a line, its `ex` nouns nest one level further — but as **alternatives, not
errands**: any ONE of them answers the line, so they render without checkboxes
and without badges. Rendering them as more boxes would say "buy all three", and
the count in the heading would be wrong.

Two counting rules keep that honest, both in `addShortfall`:

- **A key item counts once, not twice.** It's mandatory, so the moment it's in
  the basket it also satisfies a unit of its own profile. Without this, penne
  alla gin wrote "125g of penne" *and* "box of penne" as two separate errands,
  because the class label had already borrowed the key item's noun.
- **A class only partly covered by a key item asks for the remainder**, and its
  label describes what's left rather than the recipe's full requirement.

The tablet side needs `renderList`'s opt-in `group` / `child` / `option` flags
(`client/game/js/panels/tablet-os.js`); every other list in the OS passes none of
them and renders flat exactly as before.

### The kit — what you make it *in*

A recipe is not only its food. `gear.js` derives the pan, the heat and the
utensil a dish needs from data that was already there — `vessel: 'pot'` names the
pan, a profile's `turns` says whether it wants stirring or turning, its
`needsPrep` says whether it wants a knife — so all 47 catalog recipes gained a
kit list with **no edit to the catalog**, and one authored next month has one
too. It reads back three ways: the Cookbook card's **Kit** section, the workspace
Assistant's equipment check, and the shopping list.

Three rules shape it, and each prevents a specific wrong sentence:

- **The kit is DERIVED at read time, never stored.** A gram shortfall is a record
  of a decision and has to be written down; a pot is not — the recipe says which
  pan and your inventory says whether you own one, and there is nothing left for
  a stored line to add. That is what makes the backfill free (a list written
  before this existed gains its kit the moment it's opened), what makes buying
  the pot **remove** the line rather than tick it, and what stops `tidy` from
  crossing off something that comes straight back.
- **A stove is stated, never listed.** It's furniture bolted to a room, so it
  belongs on a recipe card and must never reach a list of things you carry out of
  a shop. That's the `shoppable` flag in `GEAR`.
- **Required and better are different errands.** The matcher refuses a stew
  that isn't in a pot; a missing spoon is a worse sauce, not a refusal. So a
  missing utensil never buckets a recipe under "Missing Equipment", and the list
  says outright that it'll cook without one, and worse.

Kit lines carry no number in the text list — the number is an index into the
stored list and exists only for `shoplist drop`. Two recipes wanting a pot want
one pot.

Storage is one `player_flags` row (`shoplist`), read by the verb, the Cookbook
tablet app's list screen, and the shelf marker. An entry stores `label` (the
whole line), plus `base` and `ex` kept apart so a display that can nest them
does — anything that just wants one line reads `label`.

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

## Prep: what you do before it meets heat

`score`, `tenderise`, `marinate`, `chop`, `mince`. Every one of them is a
**trade** — that's the house rule, and it's what stops any of them being a button
you always press before cooking.

| Verb | Buys | Costs |
|---|---|---|
| `score <meat>` | seasoning bonus + a wider peak window | dries out faster once you're past it |
| `tenderise <meat>` | cooks faster, much more forgiving window | one rung off the ceiling |
| `mince <meat>` | ~a third of the cook time | **two** rungs off the ceiling, forever |
| `marinate <meat> in <thing>` | the largest single pre-heat gain | real time, and the marinade item |
| `chop <food> [into N]` | faster cook — m^(2/3), so a quarter-piece is ~40% of the clock, not 25% | nothing — but it feeds you proportionally less |

Prep flags live on the ingredient's `custom_data` and are copied into the cook
session at `cook`, so the timeline is scored against what you actually did to it.
`examine` reports prep state through the **`cooking.prepText`** hook — a marinade
is a timer the player is meant to read, the same way `restText` makes resting
readable.

Prep is **spent** by the cook it was done for: `endSession` strips the flags off
the finished item, so a `finishable` component can't collect the same marinade
again on its second trip through a pan.

**The marinade clock stops when the pan starts.** Strength is frozen into the
session at `cook` as `marinade` (0..1), never recomputed at `plate`. Otherwise a
three-minute soak followed by a long slow roast would collect the full bonus and
the time cost would be decorative.

### Portions conserve

Chopping is the one prep that touches *quantity*, and its whole invariant is that
it doesn't create anything. Four quarters weigh what the whole weighed and feed
you what the whole fed you — `custom_data.portion` carries the fraction, cook
time scales by it, and `yieldOf()` shrinks the finished dish to match. Half an
onion still *satisfies* "one soft vegetable" (recipe quantities are coarse), but
the meal that comes out is smaller. Without that, chopping would be a way to make
four dinners out of one.

Two things the split deliberately does **not** do: it doesn't drop the stack (a
row of five potatoes halved is ten halves, and each new row keeps the original
`quantity`), and it doesn't copy prep — a knife does not multiply a marinade.
`minced` is the exception and survives the cut, because that's what the thing
*is* rather than something done to it.

## Boiling — water as a cooking medium

**Dry starch cooks in liquid, not in heat.** `cook` refuses a pan holding
`dry_starch` unless something in that pan carries the `liquid` profile:

> Dry box of penne in a dry cast-iron skillet will scorch, not cook. It needs
> liquid — fill cast-iron skillet at a tap, or put stock in it.

This is the only profile that refuses, and it refuses because it's the only one
that is *inedible raw*: a potato left on a dry hob is merely a bad potato, dry
pasta on a dry hob is a scorch mark. Every starch recipe's method has said "salt
the water" since the day it was written — this is that line finally being
load-bearing rather than decorative.

**Drained starch is exempt** (`needsBoiling`). Pasta that has already been boiled
and drained is a *component finishing in the sauce*, not something waiting to
cook, and a pan of tomato and cream holds no `liquid` row — so the un-exempted
gate refused the ordinary two-vessel method outright:

```
fill pot · cook pot · drain pot · stow penne in pan · cook pan · plate pan
```

That is the method [`penne alla gin`](dishes.js) is written to, step by step: the
pasta boils in the **pot**, the sauce is built in the **pan**, and the two only
meet at the end. Everything in that chain is a verb the game already had; the
only thing missing was the gate letting the last half of it happen. Filling the
pan and boiling the pasta in the sauce pan still works — one vessel is a
shortcut, not an error.

### `fill <vessel>` / `empty <vessel>`

`fill` at furniture flagged `water_source` inserts **`item_water` as an ordinary
ingredient row inside the pan**. That's the whole design decision, and it was not
the obvious one: the `fillable` plugin models fluid as a `fluid_amount` scalar on
the container, and copying that here would have meant teaching `hadLiquid`,
`deglaze`, fond suppression, the boil cue and every dish's `needs` about a second
representation of "there is water in this". Rows, and all five already understand
it.

Registration order does the routing. Specialized actions fire alphabetically and
`cooking` < `fillable`, so cookware is claimed here and **anything also tagged
`fillable` falls straight through** — a mug is a `vessel` too, and stays entirely
the drinks/fillable path. `empty` likewise falls through unless the pan actually
holds a medium.

Foul water is foul: the fill stamps `custom_data.hazards.disease_risk` from the
same `bodily.toiletContamination` dispatch the canteen path uses, and
[`hazards.js`](hazards.js) carries it onto the plate. Cooking is not a purifier
here, same as everywhere else.

### `tags.cooking_medium` — a liquid for the pan, nothing for the dish

The medium tag is the whole trick, and it's one sentence: **water counts for
every question about the PAN and no question about the DISH.**

| Asks about the pan → medium counts | Asks about the dish → medium is invisible |
|---|---|
| the `dry_starch` gate | the dish signature and `matchDish` |
| `hadLiquid` → fond suppression | the quality bands (it takes **no cook session**, so a pot of water can never reach `burnt`) |
| boil vs. sizzle on the audio cue | the dish name |
| the HUD's `fill`/`empty` offers | the Recipe Assistant's ingredient count |

Without that split, "penne and two bottles of water" comes straight back as a
valid pan of sauce — the exact bug [`dishes.js`](dishes.js) fixed by making the
sauce named rather than counted — except now with a tap to make it free.

`drain <vessel>` **deletes the medium**, which is what finally makes the verb an
act rather than a timing trick. Stock is an ingredient and *stays*: draining
ramen is a decision you'd have to make on purpose, and losing your broth to a
mistyped verb is not a lesson. `plate` consumes the medium silently along with
everything else — the water a dish was boiled in does not survive the dish.

All of it is surfaced by the workspace HUD, in three places:

- **A `Water` row on the Status board**, beside Power and Stove, naming the tap
  or reading `NONE`. A tap reads as scenery right up until the day a pan of pasta
  refuses to cook without one.
- **`fill` / `empty` on the pan itself** in the Preparation Area, the first with
  the hint *"pasta and rice will not cook without it"* when there's starch in
  there.
- **`prepare <recipe>` appends a `fill` step** to any starch plan, so it stops at
  a pan the stove will actually accept rather than one it will refuse.

Coarse gates, as always — the HUD proposes, `fill` decides. The whole chain is
covered end to end in [plugins/workspace/regress.js](../workspace/regress.js):
no tap → `cook` refused → tap added → Status names it → the pan offers `fill` →
water lands as a row → `cook` works → `drain` empties it.

## Fond

The only place in the system where one cook can see another. A good sear in a
`pan` or `tray` leaves `custom_data.fond` — `{ from, band, at }` — on the vessel,
and the next thing cooked in it is judged partly on what you do about that.

Fresh fond has three outcomes, and **none of them is neutral**:

| What you do | Worth |
|---|---|
| `deglaze <vessel>` — scrape it up | full `FOND_BONUS` (beats any seasoning; it's a technique) |
| cook something with liquid in it, unscraped | half of it — liquid lifts fond whether you meant it to or not |
| cook something dry, unscraped | `FOND_NEGLECT_PENALTY` — it sits on the heat and scorches |

Fond also **remembers what made it**. A pan you seared fish in lifts into a fruit
dish and gives you fruit that tastes of fish, so the sign flips to
`FOND_MISMATCH_PENALTY` — and it flips on the passive path too, because the
liquid doesn't care about your intentions either.

Left `FOND_LIFE_MS` it dries to **residue**, which is an active penalty on the
next cook until you `scour` the pan. That's the interesting middle state: a pan
you browned in and then ignored is *worse than a clean pan*.

Everything above is derived from the blob and `now`. `plate` writes the vessel's
fond state exactly once, in a single statement that both clears what was there
and records what replaces it.

## Taste

`taste <food|vessel>` is the one reading that isn't visual. Every other readout
in the system is something you can SEE — the colour of a crust, a simmer gone
quiet. Tasting reaches what looking can't: seasoning, and whether the thing is
any good.

**What you learn scales with Cooking skill**, which is the point. Cooking skill
had, until this, only ever changed the *outcome*; this is the first place it
changes what you *know*.

| Tier | Gets | Reads like |
|---|---|---|
| novice | 1 vague note | "It needs something. You are not sure what." |
| competent | 2 real notes | "It is flat. It wants seasoning." |
| expert | up to 4, with numbers and heat | "It is under-seasoned by about 2 things." |

A taste is a mouthful you don't get back: it stamps `tasted` on a row, and
`plate` deducts `TASTE_BITE` per bite from the dish yield. Tasting a **vessel**
is one spoonful however many things are in the pan — the bite is recorded against
a single row, because summing it across every ingredient would charge a five-item
stew five times for one taste.

Tasting a *finished* plate isn't a reading at all — it's eating a bit of it, and
returns `flavourLines()`, the same prose the eat path uses.

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
| `index.js` | the `cook` router, `plate` (single + vessel), the prep verbs, `read` on recipe cards |
| `interact.js` | `flip` / `stir` — one function, two verbs |
| `cook.js` | sessions, timers, boot catch-up, burn-off |
| `quality.js` | **pure** timeline + scoring. No DB, no clock of its own |
| `profiles.js` | the ingredient-class catalog + `validateProfiles()` |
| `dishes.js` | the dish catalog, signature matcher, naming, `validateDishes()` |
| `prep.js` | **pure** — what score/tenderise/marinate are worth, and the readout |
| `portions.js` | **pure** — the fraction arithmetic that keeps chopping honest |
| `fond.js` | **pure** — what a sear leaves behind and what lifting it is worth |
| `taste.js` | **pure** — skill-scaled tasting notes, and eating-it prose |
| `improvised.js` | **pure** — the family table, complexity→ceiling, the recipe signature |
| `gear.js` | **pure** — the kit a recipe needs (pan/heat/utensil), derived from the template |
| `shoplist.js` | the shopping list: storage, `holdings`, and the derived `answer` |
| `shoplist-cmd.js` | the `shoplist` verb, `markShelf` (`shop.stock`) and `markContainer` (`container.view`) |
| `recipes.js` | the `recipe` verb: save / rename / forget / write a card / teach |
| `workspace.js` | the `kitchen` provider for the Preparation Workspace HUD |
| `knowledge.js` | the cookbook: what's known, how it's learned, `TEACH_RECIPE`, and player recipes |
| `config.js` | every balance number in the system |

`prep.js`, `portions.js`, `fond.js`, `taste.js` and `quality.js` are all pure
reads over a row and `now` — no DB, no clock of their own. That's deliberate and
worth preserving: it's what lets `examine` be free and the regress suite test the
whole quality ladder without a database.

## No tick, no polling

A session is a timestamp blob on the food's own `player_inventory.custom_data.cooking`:

```js
{ applianceId, startedAt, thawMs, cookMs, plainDoneAt,   // plain
  profile, heatTier, heats: [], vessel: {d,r}, acts: [], // profiled only
  minced, scored, tenderised, marinade }                 // prep, copied in at `cook`
```

**Ask `finishAt(session, profile)` when a cook ends — never read the stamp.**
`plainDoneAt` is the finish line with no doneness target applied, and the moment
a player types `doneness rare` it stops being the answer (rare lands at 0.75 of
the cook, well done at 1.35). The stored field is named `plainDoneAt` rather than
`doneAt` precisely so that reaching past the accessor reads as wrong: three
separate call sites independently grabbed the old `doneAt`, and each one produced
a different bug — examine describing a rare steak as still browning, stage
narration running past the window, and an auto-burn armed against a finish line
that had moved. `finishAt` still honours a legacy `doneAt`, because sessions
written before the rename are mid-cook in `player_inventory` across any deploy.

Everything else — the peak window, the burn point, the current stage, the final
band — is *derived* from those numbers and `now`, at the moment somebody asks.
Examining a cooking steak writes nothing. Twenty examines and one examine produce
the same answer (there's a regress case asserting exactly that).

DB writes per cook: **one** on `cook`, **one** per `flip`/`stir`, **two** on
`plate` (the dish, then the pan's fond state). Each prep verb and each `taste` is
one more, and they're all player-initiated — nothing here writes on a tick or on
examine. That's the whole budget.

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
