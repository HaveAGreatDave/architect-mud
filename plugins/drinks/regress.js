// Drinks plugin regression suite — run by tests/regress.js, never in production.
//
// Most of this is pure-function assertion against the catalogue and the alcohol
// arithmetic, which is deliberate: the expensive, fragile parts of this system
// (matching, strength, cooling) were written as pure functions precisely so they
// could be pinned here without touching the database or waiting on a clock.
import { getRegisteredActions } from '../../server/engine/actions.js';
import { getRegisteredSpecializedActions } from '../../server/engine/specializedActions.js';
import { QUALITY_BANDS as ENGINE_BANDS } from '../../server/engine/quality-bands.js';
import { QUALITY_BANDS as COOKING_BANDS } from '../cooking/profiles.js';
import { CONFIG as CONSUME_CONFIG } from '../consume/index.js';
import { getItem } from '../../server/engine/items-cache.js';
import { query } from '../../server/models/db.js';
import {
  DRINKS, UNKNOWN_DRINK, GENERIC_MIXED, DRINKWARE_KINDS,
  signature, matchDrink, matchScore, drinkName, composeBand,
  validateDrinks, bestPossibleBand, describeRecipe, measureLine, methodOf,
} from './recipes.js';
import { DRINK_PROFILES, validateDrinkProfiles, poursOf, profileNameFor } from './profiles.js';
import { derivePotency, servingPotency, ethanolMl, abvOf } from './alcohol.js';
import { hotMultiplier, capacityOf, isDrinkware, drinkwareKind, makeDrink } from './vessel.js';
import { POUR_ML, STANDARD_UNIT_ML, POTENCY_MIN, POTENCY_MAX, HOT_PEAK_MS, HOT_COLD_MS, HOT_COLD_PENALTY, BREW_TIERS, VEND_BANDS, VEND_CHARGE } from './config.js';

// A synthetic ingredient row — the shape signature()/poursOf() actually read.
const ing = (profile, pours = 1, abv = 0, extra = {}) => ({
  item_id: `item_test_${profile}`, name: `test ${profile}`, quantity: 1,
  tags: { drink_profile: profile, pour_units: pours, ...(abv ? { abv } : {}), ...extra },
});

export default async function regress({ run, check, getPlayer }) {
  // ── Catalogue validation ──────────────────────────────────────────────────
  {
    const p = validateDrinkProfiles();
    check('drinks: profile catalogue validates', p.ok, p.errors.join(' | '));
    const d = validateDrinks();
    check('drinks: recipe catalogue validates', d.ok, d.errors.join(' | '));
  }

  // Every keyItems id must resolve to a real content row. dishes.js does NOT
  // check this today, and it is the cheap catch for the class of bug where a
  // renamed item silently kills a named recipe forever.
  {
    const missing = [];
    for (const [key, t] of Object.entries(DRINKS)) {
      for (const id of t.keyItems || []) if (!getItem(id)) missing.push(`${key} → ${id}`);
    }
    check('drinks: every keyItems id exists as content', missing.length === 0, missing.join(', '));
  }

  // The band vocabulary is spent by the ENGINE (COOK_QUALITY_MULT scales
  // restores by band name), so drinks and cooking must agree with it exactly.
  check('drinks: band ladder is the engine ladder',
    JSON.stringify(ENGINE_BANDS) === JSON.stringify(COOKING_BANDS),
    `${ENGINE_BANDS.length} vs ${COOKING_BANDS.length}`);

  // ── Matching ──────────────────────────────────────────────────────────────
  {
    const highball = matchDrink(signature([ing('base_spirit', 1, 40), ing('mixer', 3)]), { kind: 'glass' });
    check('drinks: spirit + 3 mixers in a glass is a highball', highball?.key === 'highball', highball?.key);

    const negroni = matchDrink(
      signature([ing('base_spirit', 1, 40), ing('liqueur', 1, 24), ing('fortified', 1, 16)]),
      { kind: 'tumbler', itemIds: new Set(['item_gin', 'item_bitter_red']) });
    check('drinks: the keyed negroni wins on its key items', negroni?.key === 'negroni', negroni?.key);

    // ...and without the key bottle it is NOT a negroni. This is the whole point
    // of keyItems: a real-world drink is defined by a specific thing in it.
    const notNegroni = matchDrink(
      signature([ing('base_spirit', 1, 40), ing('liqueur', 1, 24), ing('fortified', 1, 16)]),
      { kind: 'tumbler' });
    check('drinks: no key bottle, no negroni', notNegroni?.key !== 'negroni', notNegroni?.key);

    // A hot template is unreachable without an appliance. That IS the gate.
    const sigTea = signature([ing('tea_base', 1), ing('hot_water', 2)]);
    check('drinks: tea is unreachable without heat', matchDrink(sigTea, { kind: 'mug', hot: false })?.key !== 'black_tea');
    check('drinks: tea resolves once brewed', matchDrink(sigTea, { kind: 'mug', hot: true })?.key === 'black_tea');

    // Nothing recognisable, and not even two things that mix → sludge.
    check('drinks: one unprofiled thing is sludge',
      matchDrink(signature([{ name: 'brick', quantity: 1, tags: {} }]), { kind: 'glass' }) === null);

    // The generic fallback catches anything with two real components.
    const generic = matchDrink(signature([ing('base_spirit', 1, 40), ing('cocoa_base', 1)]), { kind: 'tankard' });
    check('drinks: two components always make SOMETHING', generic?.template === GENERIC_MIXED, generic?.key);
    check('drinks: the generic drink teaches nothing (no key)', generic?.key === null);

    // Vessel kinds are enforced — a martini is not served in a tankard.
    check('drinks: a template refuses the wrong glassware',
      matchDrink(signature([ing('base_spirit', 2, 40), ing('fortified', 1, 16)]), { kind: 'tankard' })?.key !== 'martini');

    // No scoring ties: two templates matching identically would make the winner
    // depend on object key order, which is not a thing to rely on.
    {
      const sig = signature([ing('base_spirit', 1, 40), ing('mixer', 3)]);
      const scores = Object.entries(DRINKS)
        .filter(([, t]) => !t.hot && (!t.vessels || t.vessels.includes('glass')))
        .map(([k, t]) => [k, matchScore(sig, t)]).filter(([, s]) => s >= 0)
        .sort((a, b) => b[1] - a[1]);
      check("drinks: the winning match isn't a tie",
        scores.length < 2 || scores[0][1] !== scores[1][1], JSON.stringify(scores.slice(0, 3)));
    }
  }

  // ── Naming ────────────────────────────────────────────────────────────────
  {
    const rows = [ing('base_spirit', 1, 40, { drink_noun: 'gin' }), ing('mixer', 3, 0, { drink_noun: 'tonic' })];
    check('drinks: a derived name uses both nouns',
      drinkName(DRINKS.highball, rows) === 'gin and tonic highball', drinkName(DRINKS.highball, rows));
    check('drinks: a nameFormat template ignores the parts',
      drinkName(DRINKS.negroni, rows) === 'negroni', drinkName(DRINKS.negroni, rows));
  }

  // ── Alcohol derivation ────────────────────────────────────────────────────
  {
    // Two 25ml measures at 40% = 20ml ethanol = 2.0 standard units.
    const build = [{ pours: 2, abv: 0.40 }];
    check('drinks: ethanol is pours × 25ml × abv',
      Math.abs(ethanolMl(build) - (2 * POUR_ML * 0.4)) < 1e-9, `${ethanolMl(build)}`);
    check('drinks: potency is ethanol over a standard unit',
      Math.abs(derivePotency(build) - (2 * POUR_ML * 0.4) / STANDARD_UNIT_ML) < 1e-9, `${derivePotency(build)}`);

    // Zero alcohol means NO drug at all, not a tiny one. A cup of tea can never
    // make anyone tipsy through a rounding error.
    check('drinks: a soft drink derives exactly zero',
      derivePotency([{ pours: 4, abv: 0 }]) === 0, `${derivePotency([{ pours: 4, abv: 0 }])}`);

    check('drinks: potency clamps at the floor',
      derivePotency([{ pours: 0.01, abv: 0.05 }]) === POTENCY_MIN);
    check('drinks: potency clamps at the ceiling',
      derivePotency([{ pours: 40, abv: 0.6 }]) === POTENCY_MAX);

    // Per-serving × capacity must sum back to the whole, or nursing a drink
    // would quietly change how much alcohol you took.
    const whole = derivePotency([{ pours: 3, abv: 0.4 }]);
    const per = servingPotency(whole, 3);
    check('drinks: three servings sum back to one whole drink',
      Math.abs(per * 3 - whole) < 1e-9, `${per} × 3 vs ${whole}`);

    check('drinks: abvOf reads a tag and defaults to none',
      abvOf({ tags: { abv: 40 } }) === 0.4 && abvOf({ tags: {} }) === 0);

    // Dilution falls out of the arithmetic: the same spirit in a longer drink is
    // weaker per mouthful, with no rule anywhere saying so.
    const shortDrink = servingPotency(derivePotency([{ pours: 2, abv: 0.4 }]), 2);
    const longDrink = servingPotency(derivePotency([{ pours: 2, abv: 0.4 }, { pours: 4, abv: 0 }]), 4);
    check('drinks: lengthening a drink weakens each mouthful', longDrink < shortDrink,
      `long ${longDrink} vs short ${shortDrink}`);
  }

  // ── Cooling ───────────────────────────────────────────────────────────────
  // Pure against an injected `now`, so this pins the curve without waiting
  // twenty minutes and without depending on a clock the suite can't move.
  {
    const t0 = 1_000_000;
    check('drinks: a fresh brew is at full value', hotMultiplier(t0, false, t0) === 1);
    check('drinks: still full at the end of the peak', hotMultiplier(t0, false, t0 + HOT_PEAK_MS) === 1);
    check('drinks: stone cold bottoms out', hotMultiplier(t0, false, t0 + HOT_COLD_MS + 1) === HOT_COLD_PENALTY);
    const mid = hotMultiplier(t0, false, t0 + (HOT_PEAK_MS + HOT_COLD_MS) / 2);
    check('drinks: it cools smoothly in between', mid > HOT_COLD_PENALTY && mid < 1, `${mid}`);
    check('drinks: a thermos is still hot when a mug is cold',
      hotMultiplier(t0, true, t0 + HOT_COLD_MS) > hotMultiplier(t0, false, t0 + HOT_COLD_MS));
    check('drinks: a drink that was never hot never cools', hotMultiplier(null, false, t0 + 1e9) === 1);
  }

  // ── Recipe cards ──────────────────────────────────────────────────────────
  // The card is rendered from the same template the matcher uses, so it can't
  // drift — but the arithmetic that converts pours to millilitres can, and a
  // recipe that lies about its measures is worse than no recipe at all.
  {
    check('drinks: a measure converts to real millilitres',
      measureLine('base_spirit', 2, 25) === '2 measures (50ml) of spirit', measureLine('base_spirit', 2, 25));
    check('drinks: a range reads as a range',
      measureLine('mixer', [2, 4], 25) === '2–4 measures (50–100ml) of mixer', measureLine('mixer', [2, 4], 25));
    // Modifiers are dashes. Printing "50ml of bitters" would teach a lie.
    check('drinks: modifiers are dashes, never millilitres',
      /dash/.test(measureLine('bitters', 2, 25)) && !/ml/.test(measureLine('bitters', 2, 25)),
      measureLine('bitters', 2, 25));
    check('drinks: a hot template reads as brewed', methodOf(DRINKS.black_tea) === 'Brewed');
    check('drinks: a shaken template reads as shaken', methodOf(DRINKS.sour) === 'Shaken');
    const card = describeRecipe('negroni', DRINKS.negroni, 25);
    check('drinks: a card names its glassware and its method',
      /tumbler/.test(card) && /Method:/.test(card) && /25ml/.test(card));
  }

  // ── Vessel helpers ────────────────────────────────────────────────────────
  {
    const mug = { tags: { drinkware: true, drinkware_kind: 'mug', fillable: 3 } };
    check('drinks: capacity comes off the fillable tag', capacityOf(mug) === 3);
    check('drinks: drinkware and its kind read back', isDrinkware(mug) && drinkwareKind(mug) === 'mug');
    check('drinks: a vessel with no declared capacity still has one', capacityOf({ tags: { drinkware: true } }) > 0);
    check('drinks: pours default to one so nothing vanishes', poursOf({ tags: {} }) === 1);
    check('drinks: a stack counts as its whole stack', poursOf({ tags: { pour_units: 2 }, quantity: 3 }) === 6);
  }

  // ── Wiring ────────────────────────────────────────────────────────────────
  {
    check('drinks: finishServing is registered',
      getRegisteredActions().includes('drinks.finishServing'));

    const spec = getRegisteredSpecializedActions();
    // THE FALL-THROUGH CONTRACT, and the single most breakable thing here: a
    // drinkware row with no drink in it must reach fillable and the water
    // plugin. If drinks ever stops registering BEFORE fillable, or its handler
    // stops returning undefined, `drink canteen` silently dies.
    const drinkOrder = (spec.drink || []).map(x => x.pluginName);
    check('drinks: claims `drink` before fillable',
      drinkOrder.indexOf('drinks') >= 0 && drinkOrder.indexOf('drinks') < drinkOrder.indexOf('fillable'),
      drinkOrder.join(' → '));

    // The vessel line pool. Not cosmetic: without it a mug of tea would narrate
    // "you crack the cap off with a hiss", which is a visible bug.
    const pool = CONSUME_CONFIG?.vessel;
    check('drinks: consume carries a vessel line pool',
      !!pool && pool.start?.length > 0 && pool.mid?.length > 0 && pool.finish?.length > 0);
    check("drinks: the vessel pool isn't bottle-shaped",
      !!pool && !pool.start.some(l => /cap|crack|fizz/i.test(l)),
      pool?.start?.join(' | '));
  }

  // ── Verbs ─────────────────────────────────────────────────────────────────
  {
    let r = await run('mix');
    check('drinks: bare mix asks what', r?.type === 'error' && /Mix what/i.test(r.message || ''), r?.message);

    r = await run('mix nothing into nothing');
    check('drinks: mixing into a vessel you lack is refused',
      r?.type === 'error' && /don't have/i.test(r.message || ''), r?.message);

    r = await run('brew');
    check('drinks: brew with no vessel is refused', r?.type === 'error', r?.message);

    r = await run('recipes');
    check('drinks: recipes lists the catalogue',
      r?.type === 'output' && /DRINKS YOU COULD MAKE/.test(r.message || ''), r?.message?.slice(0, 60));

    r = await run('recipes negroni');
    check('drinks: recipes names a drink prints measures',
      r?.type === 'output' && /25ml/.test(r.message || ''), r?.message?.slice(0, 60));

    r = await run('recipes flugelbinder');
    check('drinks: an unknown drink is refused politely',
      r?.type === 'error' && /never heard/i.test(r.message || ''), r?.message);
  }

  // ── Appliance tiers ───────────────────────────────────────────────────────
  {
    const bad = Object.entries(BREW_TIERS).filter(([, t]) => !ENGINE_BANDS.includes(t.ceiling));
    check('drinks: every brew tier names a real ceiling band', bad.length === 0, JSON.stringify(bad));
    check('drinks: a better tier is never a worse ceiling',
      ENGINE_BANDS.indexOf(BREW_TIERS.barista.ceiling) >= ENGINE_BANDS.indexOf(BREW_TIERS.kettle.ceiling));
  }

  // ── makeDrink: the one constructor ────────────────────────────────────────
  //
  // Two paths stamp a drink now — a player resolving a build, and a rig pulling
  // its own cup — so the shape is pinned here rather than in either of them. A
  // field missing from this object is a division by zero or a NaN somewhere a
  // long way from the thing that wrote it.
  {
    const d = makeDrink({ key: 'black_coffee', name: 'coffee', band: 'good', capacity: 2, hot: true, now: 1000 });
    const want = ['key', 'name', 'band', 'servings', 'capacity', 'thirst', 'sanity', 'potency', 'hot_at', 'made_at', 'residue', 'contaminated'];
    check('drinks: makeDrink sets every field of the shape',
      want.every(k => k in d), want.filter(k => !(k in d)).join(', '));
    check('drinks: a new drink is full to its capacity', d.servings === 2 && d.capacity === 2, `${d.servings}/${d.capacity}`);
    check('drinks: hot stamps the clock it was given, cold stamps nothing',
      d.hot_at === 1000 && makeDrink({ name: 'x', band: 'good', capacity: 1 }).hot_at === null, String(d.hot_at));
    check('drinks: servings can never exceed capacity',
      makeDrink({ name: 'x', band: 'good', capacity: 2, servings: 9 }).servings === 2);
    // The band ladder has to move the restore, or every drink is the same drink.
    check('drinks: a better band is worth more thirst',
      makeDrink({ name: 'x', band: 'masterful', capacity: 2 }).thirst > makeDrink({ name: 'x', band: 'poor', capacity: 2 }).thirst);
  }

  // ── espresso ──────────────────────────────────────────────────────────────
  //
  // Grounds and nothing else. It has to be its own template because every other
  // coffee here needs hot_water in the glass, and an espresso's water is the
  // machine's — which also means it cannot steal a match from one of them.
  {
    const sig = signature([ing('coffee_base', 1)]);
    check('drinks: grounds alone in a cup is an espresso',
      matchDrink(sig, { kind: 'cup', hot: true })?.key === 'espresso',
      matchDrink(sig, { kind: 'cup', hot: true })?.key);
    check('drinks: ...and is still unreachable without heat',
      matchDrink(sig, { kind: 'cup', hot: false })?.key !== 'espresso');
    check('drinks: ...and not in a mug, which is a small coffee in a big cup',
      matchDrink(sig, { kind: 'mug', hot: true })?.key !== 'espresso',
      matchDrink(sig, { kind: 'mug', hot: true })?.key);
    check('drinks: espresso does not steal the coffees that want water',
      matchDrink(signature([ing('coffee_base', 1), ing('hot_water', 2)]), { kind: 'cup', hot: true })?.key === 'black_coffee');
    check('drinks: ...nor the ones that want milk',
      matchDrink(signature([ing('coffee_base', 1), ing('dairy_cream', 1)]), { kind: 'cup', hot: true })?.key === 'flat_white');
  }

  // ── What a machine serves, and what it charges ────────────────────────────
  {
    const badBand = Object.entries(VEND_BANDS).filter(([, b]) => !ENGINE_BANDS.includes(b));
    check('drinks: every vend band is a real band', badBand.length === 0, JSON.stringify(badBand));
    // A machine is consistent, never brilliant. If a rig could serve the top of
    // the ladder there would be no reason to ever make anything by hand again.
    const overreach = Object.entries(VEND_BANDS).filter(([tier, b]) =>
      ENGINE_BANDS.indexOf(b) >= ENGINE_BANDS.indexOf(BREW_TIERS[tier].ceiling) && tier !== 'kettle');
    check('drinks: a rig serves below the band its tier can reach by hand',
      overreach.length === 0, JSON.stringify(overreach));
    check('drinks: no machine ever serves masterful',
      !Object.values(VEND_BANDS).includes('masterful'), JSON.stringify(VEND_BANDS));
    check('drinks: a better tier never charges less',
      VEND_CHARGE.barista >= VEND_CHARGE.machine && VEND_CHARGE.machine >= VEND_CHARGE.kettle,
      JSON.stringify(VEND_CHARGE));
  }

  // ── The machines in the world ─────────────────────────────────────────────
  //
  // A rig authored against a recipe that does not exist, or pointed at something
  // that is not a vessel, degrades to handing out an empty cup — quietly, which
  // is exactly why it is swept here instead of being left to a player to find.
  //
  // AND A PRICE MAY NEVER UNDERCUT THE CUP. You keep the cup, so a machine
  // selling ₵45 porcelain for ₵5 is a money printer with an apron on. The
  // derived price can't do that; an authored `vend_price` can, so it is checked.
  {
    const { rows } = await query(
      `SELECT id, name, flags FROM furniture WHERE flags ? 'vend_drink'`).catch(() => ({ rows: [] }));
    const noRecipe = [], noVessel = [], underCup = [], noTier = [];
    for (const f of rows) {
      const key = f.flags?.vend_drink;
      if (!DRINKS[key]) { noRecipe.push(`${f.id} → ${key}`); continue; }
      if (!BREW_TIERS[f.flags?.brew_tier]) noTier.push(`${f.id} → ${f.flags?.brew_tier}`);
      const item = getItem(f.flags?.vends);
      if (!item || !isDrinkware(item)) { noVessel.push(`${f.id} → ${f.flags?.vends}`); continue; }
      // A recipe naming vessel kinds must accept the one this machine dispenses,
      // or the rig serves a drink out of something the book says it never comes in.
      const kinds = DRINKS[key].vessels;
      if (kinds && !kinds.includes(drinkwareKind(item))) noVessel.push(`${f.id} → ${key} in a ${drinkwareKind(item)}`);
      const authored = Number(f.flags?.vend_price);
      if (Number.isFinite(authored) && authored < Number(item.value || 0)) {
        underCup.push(`${f.id} → ₵${authored} for a ₵${item.value} ${item.name}`);
      }
    }
    check('drinks: every vending machine names a recipe that exists', noRecipe.length === 0, noRecipe.join(', '));
    check('drinks: ...and dispenses it into a vessel the recipe accepts', noVessel.length === 0, noVessel.join(', '));
    check('drinks: ...from an appliance tier that exists', noTier.length === 0, noTier.join(', '));
    check('drinks: ...for at least what the vessel is worth', underCup.length === 0, underCup.join(', '));
  }
}
