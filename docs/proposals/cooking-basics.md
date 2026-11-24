# Cooking basics: a short pantry, a four-ring hob and food you handle

> **Status: design.** Nothing here is built yet. Where this disagrees with
> [plugins/cooking/README.md](../../plugins/cooking/README.md) or
> [kitchen-stage.md](kitchen-stage.md), those describe what ships today.

## Why

Cooking is deep but wide. There are lots of ingredients, and most of the
depth is in the grading. You don't get much to do with your hands. This plan
cuts the pantry to a handful of staples and spends the effort on what you do
with them: crack and whisk an egg, pour milk into it, fry it three ways, cut
bread where you put the knife, stack a sandwich and flip it in the pan. All of
it happens in the room you're standing in, on its own appliances, with an Iron
Chef sting at the big moments.

The rules stay simple and real: heat cooks, a thin thing cooks faster than a
thick one, a flipped thing cooks its other side, and liquids mix. Less is more
in the controls.

## Decisions (agreed 2026-11-22)

- **Removed food is shelved, not deleted.** Its content files move to a stored
  folder, shops stop stocking it, and copies players already hold stay and
  still work.
- **Meat is beef, chicken and pork**, each cooking a little differently.
- **Controls are click and drag plus gesture mini-games.** You drag food onto a
  ring, drag the knife to place a cut and click the pan to flip. Whisking is
  circling the mouse and a flip is a timed flick. Every action can still be
  typed.
- **Comic panels fire on big beats only** and never block input.
- **The taste system stays** and gains to it, never loses.

## The pantry

What a grocer sells:

| Type | Items |
|---|---|
| Dairy | milk, butter, cheese (a block you slice), eggs (a box of six) |
| Meat | beef, chicken, pork (raw cuts you cut down yourself) |
| Bakery | bread (a loaf you slice) |
| Staples | beef jerky, Soylent (every variety) |
| Seasoning | salt, pepper |

Stadiums, restaurants, bars and vending machines keep their prepared food.
Everything else in a grocer's stock is shelved:

- A script lists every item with a food tag that's sold by a grocer or
  general store, and which recipes and dishes need it. We review the list
  before anything moves.
- Shelved item files move to `content/stored/items/`, the same way stored
  buildings are kept, and come out of every grocer stock list. The import
  doesn't load them, but the rows already in a database are left alone, so
  held copies still resolve.
- Recipes and dishes that need a shelved item are hidden from the cookbook and
  the shopping list, not deleted. They come back if the item does.
- `content:lint` gains a check: a grocer can't stock a shelved item.

### The stock-up list by type

The shopping list (`shoplist.js`) and the fridge's Stock up panel group lines
under Dairy, Meat, Bakery, Staples and Seasoning, in that order. The type is a
`tags.aisle` on the item, falling back to its `food_profile` class. It isn't
guessed from the name.

## The hob: four rings, four heats

Today the Stage draws every ring a hob's model has (`hobRings` in room-cook.js)
and lets you drag a pan to any of them, but the server knows one heat per
cooker. So you can only really cook one thing at a time.

- The burner registry in `heat.js` is keyed by `applianceId:ring` instead of by
  appliance. A hob's ring count comes from its model, sent in the payload. A
  one-ring camp stove and the microwave are unchanged.
- Each vessel on the hob records its ring. The cook clock for that vessel reads
  that ring's heat, so two pans on high and low cook at different speeds. The
  heat log a cook already keeps is per ring.
- `stove <level>` without a ring sets the ring of the pan you're working with.
  `stove 2 high` (or `ring 2 high`) names one. Typing still wins every time.
- On the Stage each ring has its own knob on the front of the hob and its own
  flame. You drag food or a pan onto any ring, and a ring with nothing on it
  shows as free. The pan you're working with is the one the menu talks about.
  Clicking another pan makes it the one.
- A cold hob no longer opens with a ring in the middle. You pick one.

## The ingredients and how they cook

Each staple gets a small, honest cooking model in `profiles.js`, built on the
cook beats the sim already has (raw, sealed, done, overdone, burnt). Thickness
matters, so a cut piece carries its size.

| Food | What heat does to it |
|---|---|
| Egg, fried | white sets from the edge in, yolk thickens slower; a lid or a flip sets the top |
| Egg, scrambled | sets in curds while stirred; stop stirring and it browns on the bottom |
| Bread | toasts in a dry pan, faster with butter; burns |
| Cheese | softens, melts, then splits and crisps where it touches the pan |
| Butter | melts, foams, browns, then burns; it's also the fat for frying |
| Beef | sears; safe at any done-ness on a whole cut, never rare when minced |
| Chicken | has to be cooked through or it carries a hazard |
| Pork | between the two |
| Milk | warms, then scalds and catches on the bottom |

Salt and pepper go on at any time and are read by the taste system.

## The new handling

### Crack, whisk and pour

- **Crack.** Drag an egg onto the edge of a pan or bowl and flick. A clean
  crack drops the egg whole; a bad one leaves a bit of shell, which the taste
  system notes. Typed: `crack egg into pan`.
- **Whisk.** With eggs in a bowl, circle the mouse to whisk. How long and how
  steadily you whisk sets how even the mix is (a `mix` value from 0 to 1).
  Typed: `whisk bowl` gives a decent even mix.
- **Pour.** Drag a liquid (milk, or the whisked egg) onto a bowl or pan and
  hold. The longer you hold, the more goes in, and the measure shows on the
  jug. Liquids poured together are one mixture with proportions, so egg with a
  splash of milk is a different scramble from egg with a lot.
  Typed: `pour milk into bowl` pours a splash, and `pour half milk` pours half.

A mixture is one item whose `custom_data` lists its parts and their amounts.
Mixing is the general rule. Nothing is special-cased for egg and milk.

### Three eggs from one rule

Fried eggs aren't three recipes. They come from what you did:

- **Sunny side up**: cracked whole, never flipped, plated when the white is set.
- **Over easy**: flipped once, plated while the yolk is still runny.
  Over medium and over hard follow if you wait.
- **Scrambled**: whisked or stirred in the pan, and plated in curds.

The name on the plate is worked out from the record, so a player who invents
something else (a whisked egg left unstirred is an omelette) gets an honest
name for it.

### The knife goes where you put it

On the board you drag the knife across the food, and the cut lands where you
dropped it. Each cut splits the item into two items whose sizes add up to the
whole (portions already conserve). Slice a loaf as thick or thin as you like.
Cut a steak into strips or cubes. Halve a finished sandwich straight or
corner to corner. The angle of the drag is the angle of the cut.

Typed: `cut bread` takes one even slice, `cut bread 4` makes four, and
`cut sandwich diagonal` halves it.

How clean a cut is still scores as it does today (`KNIFE_PAR`).

### Stacking

Anything can go on top of anything, cooked or raw. A stack is one item that
lists its layers bottom to top, and it cooks as a whole: the bottom layer
touches the pan, heat reaches the inside slowly, and a flip swaps which side is
down. Butter on bread is a layer, the outside one, so it browns.

A grilled cheese is just a stack: butter two slices, lay one buttered side
down, put thin cheese on it, lay the other buttered side up, pan it, wait,
flip, wait, take it out, cut it. Thin cheese melts before the bread burns;
a thick slab doesn't. No grilled cheese recipe is written for any of it.

The `stack` verb and sandwiches already exist (see the README). This extends
them: a stack can go in a pan, cooks by layer, and flips.

## The look: in the room, with comic panache

- Cooking always happens on the room's own appliances (that's already true in
  a flat and in GLASS). The work here is making every hand action an animation:
  the egg arcing into the pan, the knife drawing down, butter spreading in
  strokes, a pan flipped with a toss. Each eases with the second-order
  dynamics the cats use, never a tween.
- **Comic panels.** On a big beat the camera pulls out and the moment freezes
  as a framed, inked panel with speed lines, a sound word and a narrator's
  caption, the way the microwave START does today. The beats are: the first
  crack of the day, a clean flip, a perfect cut, the plate, and a burn. Each
  plays once per cook and lasts about a second. Input isn't blocked, and
  reduced motion keeps the panel and drops the shake.
- The panels use the house comic style (`gl/house-style.js`) and the room's
  own light.

## Taste

The taste system stays as it is. It gains readings for what's new:

- **Crust** from browning on the side that touched the pan.
- **Melt** for cheese and butter: under, just right, split.
- **Texture** of eggs: runny, jammy or set yolk; soft or rubbery curds.
- **Seasoning**: salt and pepper, and too much of either.
- **Faults**: shell in the egg, a raw middle in a thick stack.

## Phases

Each phase ships on its own, with regress green and a play test in the
browser.

1. **Pantry.** The shelving script and the review list, the move to
   `content/stored/items/`, grocer stock, the stock-up list by type, hiding the
   recipes that need shelved items, the lint check.
2. **Four rings.** Per-ring heat on the server, per-ring knobs and flames on
   the Stage, `stove <ring> <level>`.
3. **Eggs and liquids.** Crack, whisk and pour, mixtures, the egg cooking
   model and the three fried eggs.
4. **The knife.** Cut by placement and angle, for bread, cheese, meat and
   finished food.
5. **Stacks in the pan.** Layered cooking, flipping, the grilled cheese as the
   test case.
6. **Panache and taste.** The hand animations, the comic panels and the new
   taste readings.

## Settled later (2026-11-22)

- Soylent stays, every variety, and it cooks: it's a liquid that warms,
  thickens and catches like milk, and it can be poured into a mixture.
- Jerky can go in a stack.
- Players own every kitchen implement (pans, pots, bowls, whisks, knives,
  boards). A kitchen comes with its appliances only, so you cook with what
  you've brought.
