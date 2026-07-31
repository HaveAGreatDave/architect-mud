// Clothing-wetness regression suite — run by tests/regress.js (never loaded in production).
// The plugin has no verbs; it's a per-minute hook. So this exercises the rate curves and,
// above all, the BARE SKIN rule, which is where the interesting bug was.
import { _test } from './index.js';

export default async function regress({ check }) {
  const { rainWettingRate, snowWettingRate, dryMultiplier, windMultiplier, humidityMultiplier,
          skinWetnessStep, SKIN_DRY_FACTOR } = _test;

  // ── Rate curves ─────────────────────────────────────────────────────────────
  check('rain wetting is quadratic (torrential soaks far faster than drizzle)',
    Math.abs(rainWettingRate(0.9) / rainWettingRate(0.3) - 9) < 1e-9, String(rainWettingRate(0.9) / rainWettingRate(0.3)));
  check('a blizzard wets slower than heavy snow (dry wind)',
    snowWettingRate(0.9) < snowWettingRate(0.7), `${snowWettingRate(0.9)} < ${snowWettingRate(0.7)}`);
  check('heat speeds drying', dryMultiplier(35) > dryMultiplier(15), `${dryMultiplier(35)} > ${dryMultiplier(15)}`);
  check('cold never slows drying below the base', dryMultiplier(-20) === 1, String(dryMultiplier(-20)));
  check('wind speeds drying, capped at a gale', windMultiplier(200) === 2.5, String(windMultiplier(200)));
  check('humid air slows drying, dry air speeds it',
    humidityMultiplier(95) < 1 && humidityMultiplier(20) > 1, `${humidityMultiplier(95)} / ${humidityMultiplier(20)}`);
  check('unknown humidity is neutral', humidityMultiplier(null) === 1, String(humidityMultiplier(null)));

  // ── Bare skin ───────────────────────────────────────────────────────────────
  // THE BUG: a player wearing nothing wettable had `wetness` pinned to 0, so a naked body
  // in freezing rain took the full −15 exposure penalty and NONE of the ×2 wet multiplier
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
  // once wind, heat or an interior multiply the base. A soaked COAT takes fifty.
  let skin = 100, mins = 0;
  while (skin > 0 && mins < 60) { skin = skinWetnessStep(skin, dry); mins++; }
  check('soaked bare skin is dry within a few minutes', mins === 7, `${mins} min`);

  // Bounds hold at both ends, so a long storm or a long dry spell can't run away.
  check('skin wetness never exceeds soaked', skinWetnessStep(99, { ...rain, wettingRate: 500 }) === 100, 'clamped high');
  check('skin wetness never goes negative', skinWetnessStep(1, dry) === 0, 'clamped low');
}
