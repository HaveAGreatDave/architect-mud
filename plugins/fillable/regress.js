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
import { getDrugCache } from '../../server/engine/drugs.js';
import { query } from '../../server/models/db.js';

export default async function regress({ run, check, getPlayer }) {
  // The three verbs are declared, tag-gated, and each has a handler.
  {
    const byVerb = Object.fromEntries(specializedActions.map(a => [a.verb, a]));
    for (const verb of ['fill', 'empty', 'drink', 'pour']) {
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
  // -- DISSOLVE is gated on the SOLID, not the container ---------------------
  //
  // The tag is on the thing you are holding, because solubility is a property of
  // the physical object: a tab of blotter goes into water and a lit cigarette
  // does not. Gating it on 'fillable' instead would have made the verb resolve
  // the canteen as its target and then have to go looking for the drug.
  {
    const byVerb = Object.fromEntries(specializedActions.map(a => [a.verb, a]));
    check('fillable: dissolve is gated on the soluble item, not the container',
      byVerb.dissolve?.requiredTag === 'soluble', byVerb.dissolve?.requiredTag);
  }

  // -- pour falls through for drinkware --------------------------------------
  //
  // Same contract as drink: decanting a cocktail works in SERVINGS and belongs to
  // the drinks plugin, which registers first. If this chain inverts, pouring a
  // negroni would start moving it in fluid units.
  {
    const order = (getRegisteredSpecializedActions().pour || []).map(x => x.pluginName);
    check('fillable: pour chain is drinks then fillable',
      order.indexOf('drinks') >= 0 && order.indexOf('drinks') < order.indexOf('fillable'),
      order.join(' -> '));
  }

  // -- THE CONTENT INVARIANTS ------------------------------------------------
  //
  // These are assertions about the world, not the code, and they exist because
  // each one is a silent failure rather than a crash.
  {
    // 1. Every bottled drug names a drug that actually exists. A prefill naming a
    //    deleted drugs row produces a container you can drink forever for nothing.
    const { rows } = await query(
      "SELECT id, tags, flags FROM items WHERE flags->'prefill'->>'fluid_type' = 'drug'");
    const cache = getDrugCache();
    const orphan = rows.filter(r => !cache[r.flags?.prefill?.drug_id]);
    check('fillable: every bottled drug prefill names a real drug',
      orphan.length === 0, orphan.map(r => r.id).join(', '));

    // 2. A fillable prefilled container must not stack. vendor.js only writes
    //    prefill down the non-stacking branch, so a stackable bottle arrives full
    //    once and empty ever after -- which no error would ever report.
    const stacky = rows.filter(r => r.tags?.stackable);
    check('fillable: no prefilled drug container is stackable',
      stacky.length === 0, stacky.map(r => r.id).join(', '));

    // 3. Every prefilled container is actually fillable. A prefill on an item with
    //    no capacity writes a fluid amount nothing can ever read back.
    const uncapped = rows.filter(r => !Number(r.tags?.fillable));
    check('fillable: every prefilled drug container has a capacity',
      uncapped.length === 0, uncapped.map(r => r.id).join(', '));

    // 4. Solubility resolves to a drug. `dissolve` reads the drug off the item id,
    //    so a soluble item no drugs row points at is a verb that always refuses.
    const { rows: sol } = await query("SELECT id FROM items WHERE jsonb_exists(tags, 'soluble')");
    const byItem = new Set(Object.values(cache).map(d => d.item_id).filter(Boolean));
    const noDrug = sol.filter(r => !byItem.has(r.id));
    check('fillable: every soluble item maps to a drug',
      noDrug.length === 0, noDrug.map(r => r.id).join(', '));

    // 5. A raw precursor drum carries NO cargo. Raws are feedstock that still has
    //    to be titrated -- a drug_id on one would make the synthesis bench
    //    optional, because you could drink the input.
    const { rows: raw } = await query(
      "SELECT id, flags FROM items WHERE jsonb_exists(tags, 'raw_drug') AND flags ? 'prefill'");
    const dosed = raw.filter(r => r.flags?.prefill?.drug_id);
    check('fillable: no raw precursor drum carries a drug_id',
      dosed.length === 0, dosed.map(r => r.id).join(', '));
  }
}
