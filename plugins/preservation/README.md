# preservation

**Purpose** — food goes off. Freshness for perishables, computed **lazily**.

## No global tick
Freshness is recomputed **on access** — examine, stow, pull, eat — through the `item.checkFreshness` hook. There is no timer sweeping the world's food. This is the cheap way to do decay, and it is exact: the answer at the moment you look is the same answer a tick would have given.

## The clock starts at the MINT, not at the first look

⚠ **This is the part lazy evaluation gets wrong if you let it.** The seed used to stamp `checkpointAt: now` the first time anything asked, which made a perishable nobody had ever examined *immortal* — a steak could sit on an apartment floor for a month and still read `fresh` the moment somebody finally looked at it. `player_inventory.created_at` (defaulted in the DDL) is the engine's own record of when the row was minted, so all ~40 mint sites — vendor deliveries, ground spawns, loot, butchering, the cooking plate — seed it for free and **a new one cannot forget to**. That's why it's a column rather than a hook fired at each mint site.

`mintedAtOf` reads it only for a perishable with no checkpoint yet, which is once in an item's life, and skips the read entirely when the caller's own projection carried the column — `resolveInventoryItem` and `cmdExamine` both do. ⚠ A row predating the column reads NULL and falls back to `now`, so **nothing already in somebody's pack starts rotting at deploy**.

⚠ **The whole span is charged at the environment resolved at CHECK time**, not the one the food actually sat in — `computeCheckpoint` takes one `envNow`, and `take` checkpoints nothing. Carry a steak out of a hot alley into a cold room and examine it there and the alley hours bill at the refrigerated rate. The only history a checkpoint can express is power loss, which is exactly why `powerLostAt` got its own stamp. Nothing else did.

## A delivery bins what has gone off

⚠ **A shop's restock target is a COUNT, and rot counts.** Once stock ages from the mint, a shelf can fill with spoiled food, satisfy `restockToQty`, and therefore never trigger another delivery — so the shop sells rot for ever. Three shops were one tick away from exactly that: Nadine Quist's steam buns (~30h), Vesna Kroh's wood chips (48h), and her jerk paste, apple butter and Dell Fry's two loaves (96h).

`stock.spoilCheck` is the second hook this plugin registers: a **pure** "could this have gone off?" answer taken from the delivery pass's own cache with no query and nothing written, so a fully-stocked shop still costs zero reads on the daily tick. It lives here because the decay curve lives here — the alternative was `vendor.js` growing its own copy of the arithmetic.

It is deliberately **optimistic** (it assumes the case has had power for the whole span, so it can only ever under-report) and ⚠ **nothing is deleted on it** — it decides only whether `cullSpoiled` goes and asks the real per-row question, which runs the same `ensureFreshnessCurrent` every other call site uses. There is one implementation of spoilage and this is not a second one. ⚠ The container's OWN zone is the observer's: stock ages where it stands, not where whoever happens to be looking is standing.

## Hooks
- `item.checkFreshness`
- `stock.spoilCheck` — the pure, query-free gate the vendor delivery pass asks

## Registers
- the `food_poisoning` status effect, for when you eat it anyway.

## Commands
- `preserve <food>` — spend a vial of BHT (`item_stabilizer`, tagged `preservative`) to slow one item's decay wherever it sits.

## The additive
The dose is a **rate multiplier** (`config.ADDITIVE_FACTOR`) stamped onto the inventory row's `custom_data.freshness.additive`, never a top-up of the freshness value — food already past `ADDITIVE_MIN_FRESHNESS` is refused rather than sold a cure. It multiplies *alongside* the tier factor, so it stacks with a fridge instead of standing in for one, and it travels with the item into a pack, a cold box, or somebody else's hands.

The reagent is deliberate: butylated hydroxytoluene is one real compound with two real jobs — holding a spliced compound together (the synthesis plugin) and keeping a fat from going rancid (this one). The expensive vial in the bag is a chemical, not a quest token.
