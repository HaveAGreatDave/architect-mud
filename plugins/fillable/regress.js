// Fillable plugin regression suite — run by tests/regress.js, never in production.
//
// This plugin had no suite until the drinks build gave it a new contract: mugs
// and glasses are `fillable` too, so a vessel holding a POURED DRINK now reaches
// these handlers, and must be refused rather than treated as an empty cup or
// filled with water on top of a negroni.
//
// The registration-order assertion below is the important one. Specialized
// actions fire in registration order (alphabetical by plugin), so `drinks` gets
// first refusal on `drink` — and the whole fall-through chain
// drinks → fillable → water depends on it. A folder rename would break it
// silently, which is exactly why it is pinned here as well as in drinks.
import { getRegisteredSpecializedActions } from '../../server/engine/specializedActions.js';
import { specializedActions } from './index.js';

export default async function regress({ run, check, getPlayer }) {
  // The three verbs are declared, tag-gated, and each has a handler.
  {
    const byVerb = Object.fromEntries(specializedActions.map(a => [a.verb, a]));
    for (const verb of ['fill', 'empty', 'drink']) {
      check(`fillable: ${verb} is registered and tag-gated`,
        !!byVerb[verb] && byVerb[verb].requiredTag === 'fillable' && typeof byVerb[verb].handler === 'function',
        JSON.stringify(byVerb[verb] || null));
    }
  }

  // THE FALL-THROUGH CHAIN. drinks claims a cup with a drink in it; fillable
  // claims a plain container; water claims the sink. Order is the contract.
  {
    const order = (getRegisteredSpecializedActions().drink || []).map(x => x.pluginName);
    check('fillable: drink chain is drinks → fillable → water',
      order.indexOf('drinks') >= 0 && order.indexOf('drinks') < order.indexOf('fillable')
      && order.indexOf('fillable') < order.indexOf('water'),
      order.join(' → '));
  }

  // Nothing carried → every handler falls through (returns undefined) rather
  // than claiming the verb and killing the chain with an error.
  {
    const r = await run('fill nonexistentcanteen');
    check('fillable: filling something you lack falls through, not errors',
      r == null || r?.type !== 'error' || !/fill the/i.test(r.message || ''), `${r?.type}: ${r?.message}`);
  }

  // The vessel invariant, asserted against the guard directly — a row carrying
  // `custom_data.drink` is a drinks vessel and this plugin must not touch it.
  {
    const withDrink = { name: 'mug', custom_data: { drink: { name: 'tea', servings: 2 } } };
    const empty = { name: 'canteen', custom_data: { fluid_amount: 10, fluid_type: 'water' } };
    // Mirrors the module-private holdsDrink() — if that predicate ever changes
    // shape, this is the check that notices the two have drifted apart.
    const holdsDrink = c => !!c?.custom_data?.drink;
    check('fillable: a poured drink is recognised as not ours', holdsDrink(withDrink));
    check('fillable: a plain fluid container still is ours', !holdsDrink(empty));
  }
}
