// Topical plugin regression suite — run by tests/regress.js (never loaded in production).
//
// Deliberately READ-ONLY where it can be. `sprayconsent on` writes player_flags
// and the fake player has no players row to cascade off, so a toggle test would
// leave a junk flag behind on every run. The gate itself is exercised through
// the substrate, where no write is needed to prove it.
import {
  applyTopical, needsTopicalConsent, fluidInfo, registerTopicalEffect,
  hasTopicalEffect, hasTopicalWetting, describeContainerFluid, isHarmfulFluid,
  getTopicalConsent, systemicDose, hasTopicalDosing, MIN_SYSTEMIC_DOSE, TOPICAL_FLUIDS,
} from '../../server/engine/topical.js';

export default async function regress({ run, check, getPlayer }) {
  let r = await run('sprayconsent');
  check('sprayconsent verb routed', /get liquid on you/i.test(r?.message || ''), r?.message);
  check('…and a player who never touched it reads as allowed',
    /CAN get liquid/.test(r?.message || ''), r?.message);

  r = await run('sprayconsent wobble');
  check('sprayconsent rejects junk arg', /sprayconsent on/.test(r?.message || ''), r?.message);

  r = await run('splash');
  check('splash asks whom', /Splash whom/i.test(r?.message || ''), r?.message);

  r = await run('splash nobodyxyz');
  check('splash resolves the target before the container', /can't see/i.test(r?.message || ''), r?.message);

  // ── The gate ──────────────────────────────────────────────────────────────
  const me = getPlayer();
  check('consent needed player→player', needsTopicalConsent(me, { id: 'other' }) === true);
  check('no consent needed from the world', needsTopicalConsent(me, null) === false);
  check('no consent needed from yourself', needsTopicalConsent(me, me) === false);

  // DEFAULT ON. The fake player has no flag row, which is exactly the state a
  // player who has never touched the setting is in — and a liquid must land on
  // them, or the whole system is inert for everybody by default.
  check('an untouched setting means yes', (await getTopicalConsent(me)) === true);
  const landed = await applyTopical(me, { fluid: 'water', actor: { id: 'someone-else' } });
  check('a player who never chose still gets splashed', landed.applied === true, landed.reason);

  // …and off is off. Faked here rather than written, since the suite never
  // leaves flag rows behind (see the header).
  const refuser = { id: 'refuser', _flags: new Map([['topical_consent', 'false']]) };
  const res = await applyTopical(refuser, { fluid: 'water', actor: me });
  check('a player who turned it off is not splashed',
    res.applied === false && res.reason === 'no_consent', res.reason);
  check('refusal message is physical, not administrative',
    !/consent/i.test(res.message || ''), res.message);

  // ── The law: every liquid wets you ────────────────────────────────────────
  check('the wetting pass is claimed by its owner', hasTopicalWetting() === true);
  check('every catalogued fluid is wet',
    Object.values(TOPICAL_FLUIDS).every(f => f.wets === true),
    Object.entries(TOPICAL_FLUIDS).filter(([, f]) => !f.wets).map(([k]) => k).join(','));

  // An uncatalogued liquid still lands and still wets — it just does nothing
  // else. This is what stops a new fluid being silently inert.
  const unknown = await applyTopical({ id: 'someone-else', wetness: 0 }, { fluid: 'nosuchfluid' });
  check('an unknown liquid still lands', unknown.applied === true, unknown.reason);
  check('…and still wets, because that is the law', unknown.reason === 'wet', unknown.reason);
  check('…and reads as a liquid', /wet/.test(fluidInfo('nosuchfluid').arrival));

  // ── The fluid table ───────────────────────────────────────────────────────
  check('acid and fuel are flagged harmful', isHarmfulFluid('acid') && isHarmfulFluid('fuel'));
  check('water and beer are not', !isHarmfulFluid('water') && !isHarmfulFluid('booze'));
  check('only the hot drink is hot',
    Object.entries(TOPICAL_FLUIDS).filter(([, f]) => f.hot).map(([k]) => k).join(',') === 'hot_drink');
  check('the fluids that stain name a real contaminant',
    Object.values(TOPICAL_FLUIDS).every(f => !f.stain || typeof f.stain === 'string'));

  // ── The container registries ──────────────────────────────────────────────
  // fillable and drinks each answer for their OWN schema; the substrate knows
  // neither. An empty vessel is not a liquid, which is what `splash` reports on.
  const canteen = describeContainerFluid({ custom_data: { fluid_amount: 12, fluid_type: 'water' } });
  check('a full canteen resolves to water', canteen?.fluid === 'water', JSON.stringify(canteen));
  check('…at full strength', canteen?.potency === 1, String(canteen?.potency));
  const dregs = describeContainerFluid({ custom_data: { fluid_amount: 3, fluid_type: 'water' } });
  check('a mouthful is a flick, not a soaking', (dregs?.potency ?? 1) < 0.5, String(dregs?.potency));
  const bad = describeContainerFluid({ custom_data: { fluid_amount: 12, fluid_type: 'water', contaminated: true } });
  check('bad water is its own liquid', bad?.fluid === 'dirty_water', JSON.stringify(bad));
  const fuel = describeContainerFluid({ custom_data: { fluid_amount: 12, fluid_type: 'fuel' } });
  check('a jerry can resolves to fuel', fuel?.fluid === 'fuel', JSON.stringify(fuel));
  check('an empty container holds no liquid', describeContainerFluid({ custom_data: {} }) === null);
  check('a bare item holds no liquid', describeContainerFluid(null) === null);

  const pint = describeContainerFluid({ tags: {}, custom_data: { drink: { name: 'a pint', servings: 2, capacity: 2, potency: 1.4 } } });
  check('a glass of liquor resolves to booze', pint?.fluid === 'booze', JSON.stringify(pint));
  const soda = describeContainerFluid({ tags: {}, custom_data: { drink: { name: 'a cola', servings: 1, capacity: 1, potency: 0 } } });
  check('a soft drink is not booze', soda?.fluid === 'soft_drink', JSON.stringify(soda));
  const coffee = describeContainerFluid({ tags: {}, custom_data: { drink: { name: 'a coffee', servings: 1, capacity: 1, potency: 0, hot_at: Date.now() } } });
  check('a fresh coffee is a scalding drink', coffee?.fluid === 'hot_drink', JSON.stringify(coffee));
  const stale = describeContainerFluid({ tags: {}, custom_data: { drink: { name: 'a coffee', servings: 1, capacity: 1, potency: 0, hot_at: Date.now() - 60 * 60 * 1000 } } });
  check('…but a cold one is just a drink', stale?.fluid === 'soft_drink', JSON.stringify(stale));
  check('the fillable resolver does not claim a drink vessel',
    describeContainerFluid({ custom_data: { fluid_amount: 5, drink: { name: 'x', servings: 1, capacity: 1 } } })?.fluid !== 'water');

  // ── Effects ───────────────────────────────────────────────────────────────
  for (const f of ['fuel', 'acid', 'booze', 'hot_drink', 'soft_drink', 'dirty_water']) {
    check(`${f} has a registered consequence`, hasTopicalEffect(f) === true);
  }

  // A splash hurts and never kills — killing routes through a death path this
  // verb has no business owning.
  const nearlyDead = { id: 'splash-regress', hp: 2, hp_max: 100 };
  await applyTopical(nearlyDead, { fluid: 'acid', potency: 1 });
  check('acid hurts', nearlyDead.hp < 2, String(nearlyDead.hp));
  check('…but a thrown cup can never kill', nearlyDead.hp >= 1, String(nearlyDead.hp));

  // ── Absorption: on you vs INTO you ────────────────────────────────────────
  // dose = potency × absorb × skinExposure, floored at MIN_SYSTEMIC_DOSE.
  check('a solvent carries what is in it straight through',
    systemicDose({ potency: 1, absorb: 0.85, skinExposure: 1 }) > 0.5,
    String(systemicDose({ potency: 1, absorb: 0.85, skinExposure: 1 })));
  check('alcohol sits on the skin and does nothing — a full pint on a bare chest',
    systemicDose({ potency: 1, absorb: TOPICAL_FLUIDS.booze.absorb, skinExposure: 1 }) === 0,
    String(systemicDose({ potency: 1, absorb: TOPICAL_FLUIDS.booze.absorb, skinExposure: 1 })));
  check('water carries nothing systemically, ever',
    systemicDose({ potency: 1, absorb: TOPICAL_FLUIDS.water.absorb, skinExposure: 1 }) === 0);
  check('a trace under the floor is nothing, not a rounding-error dose',
    systemicDose({ potency: 0.2, absorb: 0.5, skinExposure: 0.5 }) === 0,
    'below MIN_SYSTEMIC_DOSE');
  check('the minimum is what stops a thousand nothings becoming an addiction',
    MIN_SYSTEMIC_DOSE > 0 && MIN_SYSTEMIC_DOSE < 0.5, String(MIN_SYSTEMIC_DOSE));

  // Clothes are chemical protection, because skinExposure IS the layer walk.
  const bare = systemicDose({ potency: 1, absorb: 0.85, skinExposure: 1 });
  const coated = systemicDose({ potency: 1, absorb: 0.85, skinExposure: 0.15 });
  check('a coat cuts the dose that reaches you', coated < bare, `${coated} vs ${bare}`);
  check('a sealed shell stops the dose entirely',
    systemicDose({ potency: 1, absorb: 0.85, skinExposure: 0.05 }) === 0, 'shielded');

  // The pass that turns a dose into an actual drug, and the drug id riding on
  // the CONTAINER rather than the fluid table — a carrier and its cargo.
  check('the dosing pass is claimed', hasTopicalDosing() === true);
  check('the fluid table names no drug ids',
    Object.values(TOPICAL_FLUIDS).every(f => f.drug === undefined));
  const laced = describeContainerFluid({ custom_data: { fluid_amount: 12, fluid_type: 'solvent', drug_id: 'drug_blotter' } });
  check('a laced canteen names its cargo', laced?.drug === 'drug_blotter', JSON.stringify(laced));
  check('a plain canteen carries nothing',
    describeContainerFluid({ custom_data: { fluid_amount: 12, fluid_type: 'water' } })?.drug === null);
  check('a boozy drink names its alcohol honestly', pint?.drug === 'drug_alcohol', pint?.drug);
  check('…and a soft drink names nothing', soda?.drug === null, String(soda?.drug));

  // End to end: applyTopical reports what got in.
  const soaked = await applyTopical({ id: 'dose-regress', wetness: 0 },
    { fluid: 'solvent', potency: 1, drug: 'drug_blotter' });
  check('a solvent splash reports a real dose', (soaked.dose || 0) > 0, String(soaked.dose));
  const beer = await applyTopical({ id: 'dose-regress-2', wetness: 0 }, { fluid: 'booze', potency: 1, drug: 'drug_alcohol' });
  check('a thrown pint reports no dose at all', beer.dose === 0, String(beer.dose));

  registerTopicalEffect('__regress_probe', () => ({ message: 'probe' }));
  const probed = await applyTopical({ id: 'someone-else' }, { fluid: '__regress_probe' });
  check('a fluid effect gets the last word over the wetting pass',
    probed.message === 'probe', probed.message);
}
