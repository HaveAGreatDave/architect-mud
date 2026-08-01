# preservation

**Purpose** — food goes off. Freshness for perishables, computed **lazily**.

## No global tick
Freshness is recomputed **on access** — examine, stow, pull, eat — through the `item.checkFreshness` hook. There is no timer sweeping the world's food. This is the cheap way to do decay, and it is exact: the answer at the moment you look is the same answer a tick would have given.

## Hooks
- `item.checkFreshness`

## Registers
- the `food_poisoning` status effect, for when you eat it anyway.

## Commands
- `preserve <food>` — spend a vial of BHT (`item_stabilizer`, tagged `preservative`) to slow one item's decay wherever it sits.

## The additive
The dose is a **rate multiplier** (`config.ADDITIVE_FACTOR`) stamped onto the inventory row's `custom_data.freshness.additive`, never a top-up of the freshness value — food already past `ADDITIVE_MIN_FRESHNESS` is refused rather than sold a cure. It multiplies *alongside* the tier factor, so it stacks with a fridge instead of standing in for one, and it travels with the item into a pack, a cold box, or somebody else's hands.

The reagent is deliberate: butylated hydroxytoluene is one real compound with two real jobs — holding a spliced compound together (the synthesis plugin) and keeping a fat from going rancid (this one). The expensive vial in the bag is a chemical, not a quest token.
