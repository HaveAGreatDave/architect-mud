// Clothing-wetness regression suite — run by tests/regress.js (never loaded in production).
// The plugin has no verbs; it's a per-minute hook. So this exercises the rate curves, the
// LAYER WALK (water runs outside-in, which is the rule the whole plugin is arranged around),
// and the BARE SKIN rule, which is where the original interesting bug was.
import { _test } from './index.js';

export default async function regress({ check }) {
  const { rainWettingRate, snowWettingRate, dryMultiplier, windMultiplier, humidityMultiplier,
          skinWetnessStep, SKIN_DRY_FACTOR, COVERED_SKIN_DRY_FACTOR,
          layerPassthrough, layerRank, slotsOf, stackFlux, drivenRainMultiplier,
          absorbStep, dryStep, BODY_SLOTS, SLOT_AREA } = _test;

  // Minutes for one exposed garment to go from bone-dry to soaked at a given precip rate.
  const minsToSoaked = (precip) => {
    let w = 0, m = 0;
    while (w < 100 && m < 600) { w = absorbStep(w, rainWettingRate(precip)); m++; }
    return m;
  };

  // ── Rate curves ─────────────────────────────────────────────────────────────
  check('rain wetting is superlinear (torrential soaks far faster than drizzle)',
    rainWettingRate(0.9) / rainWettingRate(0.3) > 3, String(rainWettingRate(0.9) / rainWettingRate(0.3)));
  // The old precipRate² curve suppressed the bottom of the range so hard that light rain
  // took 37 minutes to soak a coat. Real light rain has you visibly wet inside ten.
  check('light rain soaks you in a believable time, not most of an hour',
    minsToSoaked(0.3) >= 10 && minsToSoaked(0.3) <= 25, `${minsToSoaked(0.3)} min`);
  check('moderate rain is under ten minutes', minsToSoaked(0.5) <= 12, `${minsToSoaked(0.5)} min`);
  check('torrential rain is still the fast case it always was',
    minsToSoaked(0.95) >= 2 && minsToSoaked(0.95) <= 6, `${minsToSoaked(0.95)} min`);
  check('a blizzard wets slower than heavy snow (dry wind)',
    snowWettingRate(0.9) < snowWettingRate(0.7), `${snowWettingRate(0.9)} < ${snowWettingRate(0.7)}`);

  check('heat speeds drying', dryMultiplier(35) > dryMultiplier(15), `${dryMultiplier(35)} > ${dryMultiplier(15)}`);
  check('cold never slows drying below the base', dryMultiplier(-20) === 1, String(dryMultiplier(-20)));
  check('wind speeds drying, capped at a gale', windMultiplier(200) === 2.5, String(windMultiplier(200)));
  check('humid air slows drying, dry air speeds it',
    humidityMultiplier(95) < 1 && humidityMultiplier(20) > 1, `${humidityMultiplier(95)} / ${humidityMultiplier(20)}`);
  check('unknown humidity is neutral', humidityMultiplier(null) === 1, String(humidityMultiplier(null)));

  // Wind drives rain INTO cloth as well as drying it — but weaker than it dries, so a gale
  // is still net-drying once the rain stops.
  check('wind drives rain in harder', drivenRainMultiplier(60) > drivenRainMultiplier(0), String(drivenRainMultiplier(60)));
  check('driven rain is capped, and always weaker than the drying bonus',
    drivenRainMultiplier(500) === 1.6 && drivenRainMultiplier(500) < windMultiplier(500), String(drivenRainMultiplier(500)));

  // ── Drying is proportional, not linear ──────────────────────────────────────
  // The old model subtracted a flat rate, so a soaked coat shed its last 10 points as fast
  // as its first 10. Evaporation goes with the water that's left; the tail is the slow part.
  check('a soaked garment dries faster than a barely-damp one',
    (100 - dryStep(100, 2)) > (10 - dryStep(10, 2)), `${100 - dryStep(100, 2)} vs ${10 - dryStep(10, 2)}`);
  check('drying still terminates rather than crawling at zero forever', dryStep(0.1, 2) === 0, String(dryStep(0.1, 2)));
  check('drying never goes negative', dryStep(0, 99) === 0, String(dryStep(0, 99)));

  // Absorption tapers toward saturation but still gets there.
  check('absorption slows as a garment fills', absorbStep(90, 10) - 90 < absorbStep(0, 10), 'tapered');
  check('absorption still reaches soaked', absorbStep(99, 50) === 100, String(absorbStep(99, 50)));

  // ── Layering: water runs outside-in ─────────────────────────────────────────
  const coat    = { tags: { slot: 'torso', layer: 'outerwear', gets_wet: true } };
  const shirt   = { tags: { slot: 'torso', layer: 'underwear', gets_wet: true } };
  const slicker = { tags: { slot: 'torso', layer: 'armor', waterproof: true } };
  const plate   = { tags: { slot: 'torso', layer: 'armor' } };       // no gets_wet: holds nothing
  const suit    = { tags: { slot: 'torso', covers: ['legs'], layer: 'outerwear', gets_wet: true } };

  check('layers sort outermost first', layerRank(slicker) < layerRank(coat) && layerRank(coat) < layerRank(shirt), 'armor < outerwear < underwear');
  check('an unset layer defaults to outerwear', layerRank({ tags: { slot: 'torso' } }) === layerRank(coat), 'defaults');
  check('a covering garment reports every slot it sits over',
    slotsOf(suit).join(',') === 'torso,legs', slotsOf(suit).join(','));
  check('weapon_hand and accessory are not coverage',
    slotsOf({ tags: { slot: 'accessory' } }).length === 0, 'no body slots');

  // THE HEADLINE FIX: the old model wet every garment at the same rate simultaneously, so
  // a slicker over a shirt left the shirt exactly as soaked as no slicker at all.
  const bare = stackFlux([shirt], 10, () => 0);
  const under = stackFlux([slicker, shirt], 10, () => 0);
  check('a waterproof shell actually shields what is under it',
    under.arrivals.get(shirt) < bare.arrivals.get(shirt) * 0.2,
    `${under.arrivals.get(shirt)} vs ${bare.arrivals.get(shirt)}`);
  check('the outermost layer still takes the full weather',
    under.arrivals.get(slicker) === 10, String(under.arrivals.get(slicker)));

  // …and the part that makes it feel real: a DRY coat protects, a SOAKED one doesn't.
  const dryCoat  = stackFlux([coat, shirt], 10, (i) => (i === coat ? 0   : 0));
  const wetCoat  = stackFlux([coat, shirt], 10, (i) => (i === coat ? 100 : 0));
  check('a dry coat keeps the shirt under it mostly dry',
    dryCoat.arrivals.get(shirt) < 2, String(dryCoat.arrivals.get(shirt)));
  check('a soaked coat stops protecting anything',
    wetCoat.arrivals.get(shirt) > dryCoat.arrivals.get(shirt) * 4, `${wetCoat.arrivals.get(shirt)} vs ${dryCoat.arrivals.get(shirt)}`);

  // Hard armour holds no water, so it sheds onto what's below rather than absorbing.
  check('plate armour passes water down instead of soaking it up',
    layerPassthrough(plate, 0) > layerPassthrough(coat, 0), `${layerPassthrough(plate, 0)} vs ${layerPassthrough(coat, 0)}`);

  check('skin under a full stack stays drier than bare skin',
    stackFlux([slicker, coat, shirt], 10, () => 0).skinFlux < stackFlux([], 10, () => 0).skinFlux,
    'sheltered');
  check('bare skin takes the whole of it', stackFlux([], 10, () => 0).skinFlux === 10, 'unsheltered');

  // ── Body-area weighting ─────────────────────────────────────────────────────
  // `player.wetness` used to be an unweighted mean over garments, so a wet hat counted for
  // as much as a wet coat and putting on more clothes changed the number without changing
  // anything physical.
  const areaSum = BODY_SLOTS.reduce((n, s) => n + SLOT_AREA[s], 0);
  check('slot areas cover the whole body exactly once', Math.abs(areaSum - 1) < 1e-9, String(areaSum));
  check('every body slot has an area', BODY_SLOTS.every(s => SLOT_AREA[s] > 0), BODY_SLOTS.join(','));
  check('the torso and legs dominate', SLOT_AREA.torso + SLOT_AREA.legs > 0.7, String(SLOT_AREA.torso + SLOT_AREA.legs));

  // ── Bare skin ───────────────────────────────────────────────────────────────
  // THE ORIGINAL BUG: a player wearing nothing wettable had `wetness` pinned to 0, so a naked
  // body in freezing rain took the full −15 exposure penalty and NONE of the ×2 wet multiplier
  // that the cold tick applies. Stripping off was a way to shrug off a storm.
  const rain = { isPrecipitating: true, wettingRate: rainWettingRate(0.6), dryRate: 2 };
  check('bare skin gets wet in the rain (it is not permanently dry)',
    skinWetnessStep(0, rain) > 0, String(skinWetnessStep(0, rain)));
  check('bare skin wets at the same rate cloth does',
    skinWetnessStep(0, rain) === rain.wettingRate, `${skinWetnessStep(0, rain)} vs ${rain.wettingRate}`);

  // …but it holds no water, so it sheds far faster than a soaked coat does.
  const dry = { isPrecipitating: false, wettingRate: 0, dryRate: 2 };
  check('bare skin dries much faster than cloth',
    (100 - skinWetnessStep(100, dry)) === 2 * SKIN_DRY_FACTOR, String(skinWetnessStep(100, dry)));
  // 16/min at the outdoor base rate ⇒ soaked to bone-dry in seven minutes, and faster still
  // once wind, heat or an interior multiply the base. A soaked COAT takes far longer.
  let skin = 100, mins = 0;
  while (skin > 0 && mins < 60) { skin = skinWetnessStep(skin, dry); mins++; }
  check('soaked bare skin is dry within a few minutes', mins === 7, `${mins} min`);

  // Skin under cloth barely airs — which is the honest reason to take a wet coat off.
  check('skin under a garment stays clammy far longer than bare skin',
    skinWetnessStep(100, { ...dry, dryFactor: COVERED_SKIN_DRY_FACTOR }) > skinWetnessStep(100, dry),
    `${skinWetnessStep(100, { ...dry, dryFactor: COVERED_SKIN_DRY_FACTOR })} vs ${skinWetnessStep(100, dry)}`);

  // Bounds hold at both ends, so a long storm or a long dry spell can't run away.
  check('skin wetness never exceeds soaked', skinWetnessStep(99, { ...rain, wettingRate: 500 }) === 100, 'clamped high');
  check('skin wetness never goes negative', skinWetnessStep(1, dry) === 0, 'clamped low');
}
