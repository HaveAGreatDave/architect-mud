// Preservation — event-driven, timestamp-based freshness for perishable food.
// No global tick: freshness is checked lazily via the `item.checkFreshness`
// hook, fired by the engine from examine, stow, pull, and eat/use (see
// server/engine/commands/{world,inventory}.js). See decay.js for the math.
import { registerStatusEffect } from '../../server/engine/effects.js';
import { ensureFreshnessCurrent } from './decay.js';

// Registered here (not in effects.js) per that module's own extension pattern —
// spoiled food applies this instead of its normal restores (inventory.js).
registerStatusEffect({
  name: 'food_poisoning',
  label: 'Food Poisoning',
  onTick(player) {
    player.hp = Math.max(0, player.hp - 3);
    if (Math.random() < 0.3) {
      player.stamina = Math.max(0, (player.stamina ?? 0) - 5);
      return 'Your stomach churns. (-3 HP, -5 STA)';
    }
    return 'Your stomach churns. (-3 HP)';
  },
});

export const hooks = { 'item.checkFreshness': ensureFreshnessCurrent };

// Exposed for the regression harness.
export const _test = { ensureFreshnessCurrent };
