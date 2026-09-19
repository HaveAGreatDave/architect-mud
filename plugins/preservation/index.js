// Preservation — event-driven, timestamp-based freshness for perishable food.
// No global tick: freshness is checked lazily via the `item.checkFreshness`
// hook, fired by the engine from examine, stow, pull, and eat/use (see
// server/engine/commands/{world,inventory}.js). See decay.js for the math.
import { ensureFreshnessCurrent, stockSpoilCheck } from './decay.js';
import { cmdPreserve } from './preserve.js';

// `food_poisoning` used to be registered HERE, back when spoiled food was the
// only thing that caused it. It is now applied by four separate paths — spoiled
// food, raw food, meat eaten deliberately rare, and a botched cook — so it has
// moved to the engine's core effect set alongside bleeding and choking
// (server/engine/effects.js).
//
// This matters more than it looks: registerStatusEffect OVERWRITES by name, and
// plugins load after the engine, so a copy left here would silently shadow the
// engine one with no warning anywhere.

// `stock.spoilCheck` is the vendor delivery pass asking, from its own cache and
// with no query, whether a shelf of stock has gone off — see stockSpoilCheck for
// why it is a separate, pure entry point rather than a second call to the one
// above (which needs a row, and writes).
export const hooks = {
  'item.checkFreshness': ensureFreshnessCurrent,
  'stock.spoilCheck': stockSpoilCheck,
};

// `preserve <food>` — the antioxidant half. Spends a vial of BHT to slow one
// item's decay wherever it sits; see preserve.js for why that reagent and not
// an invented one.
export const commands = { preserve: cmdPreserve };

// Exposed for the regression harness.
export const _test = { ensureFreshnessCurrent, stockSpoilCheck };
