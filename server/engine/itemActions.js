/**
 * Item affordances — the canonical "what can you do with this thing" list, shared
 * by the inventory/gear payloads (the client item menu, the smart bar's item
 * guide) and by `examine`/`help <item>`, so the menu and the prose can never
 * disagree. The sibling of furnitureActions.js, for the things you carry.
 *
 * It also owns `consumeVerb` — the answer to "how is this consumable actually
 * taken", which is a different question from "does this run through the consume
 * path". `consumable` only ever meant the second one: it is the tag the
 * effect/payout code keys on, so a ration, a bandage, a hand warmer and a credit
 * chip all carry it, and reading it as "edible" is what put an Eat button on a
 * roll of gauze.
 */
import { hasTag } from './tags.js';
import { availableActions } from './specializedActions.js';

// Consumed by being put ON something, or spent — never swallowed, whatever else
// the item restores. Tested first, because a drawing poultice pulls radiation
// out of you and is still a rag you press against a burn.
const APPLIED_TAGS = ['treat_injury', 'treat_frostbite', 'warming', 'currency'];

/**
 * The one verb a consumable is taken by: `eat`, `drink` or `use`.
 *
 * Every test reads a tag some other system already needed, so no item is
 * re-authored to say a second time what it has already said. `use` is the
 * catch-all rather than a category of its own — a stim, a pill and an amp are
 * all consumed, just not at a table, and "use" is the honest word for all three.
 */
export function consumeVerb(item) {
  if (APPLIED_TAGS.some(t => hasTag(item, t))) return 'use';
  // Poured. The first three are the drinks plugin's own markers; the fourth
  // catches a plain bottle nobody profiled. Checked before food, because the
  // cooking system profiles drinkable things as ingredients too — a bottle of
  // water is a `food_profile` and is still a drink.
  if (hasTag(item, 'drink_profile') || hasTag(item, 'pour_units') || hasTag(item, 'hydrating') || hasTag(item, 'mutagen')) return 'drink';
  if (hasTag(item, 'restore_thirst') && !hasTag(item, 'restore_hunger')) return 'drink';
  if (hasTag(item, 'food_profile') || hasTag(item, 'food_noun') || hasTag(item, 'restore_hunger')) return 'eat';
  return 'use';
}

// The verbs an item affords, de-duped, in registry order. Equip/unequip are the
// caller's business (they're state-dependent on is_equipped) and aren't here.
export function itemVerbs(item) {
  const verbs = availableActions(item);

  // The food plugin advertises `eat` on the bare `consumable` tag, which is as
  // far as the registry's tag gate can see. Narrow it to the verb the item is
  // actually taken by, so gauze offers Use and a water bottle offers Drink.
  if (hasTag(item, 'consumable')) {
    const want = consumeVerb(item);
    const out = verbs.filter(v => v !== 'eat' && v !== 'drink');
    if (!out.includes(want)) out.push(want);
    return out;
  }

  // A non-food usable — an explicit `use_message` but not `consumable` — surfaces
  // `use`, which nothing in the registry would have advertised for it.
  if (hasTag(item, 'use_message') && !verbs.includes('use')) verbs.push('use');
  return verbs;
}
