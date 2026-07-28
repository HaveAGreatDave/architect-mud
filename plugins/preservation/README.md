# preservation

**Purpose** — food goes off. Freshness for perishables, computed **lazily**.

## No global tick
Freshness is recomputed **on access** — examine, stow, pull, eat — through the `item.checkFreshness` hook. There is no timer sweeping the world's food. This is the cheap way to do decay, and it is exact: the answer at the moment you look is the same answer a tick would have given.

## Hooks
- `item.checkFreshness`

## Registers
- the `food_poisoning` status effect, for when you eat it anyway.

## Commands
None.
