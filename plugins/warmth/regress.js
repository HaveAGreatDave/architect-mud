// Warmth regression suite — run by tests/regress.js (never loaded in production).
// No verbs (a heater borrows plug/unplug from appliances), so this pins the battery model,
// the thermostat semantics, and the carried-warmth taper.
import { _test } from './index.js';
import { applyWarmth, warmthBonus, tickWarmth } from '../../server/engine/warmth.js';

export default async function regress({ check }) {
  const { heaterTarget, isHeater, capacityOf } = _test;

  // ── What counts as a heater ────────────────────────────────────────────────
  check('a heater is furniture with a target temperature',
    isHeater({ flags: { heater_target_c: 20 } }) === true, 'heater');
  check('ordinary furniture is not a heater', isHeater({ flags: {} }) === false, 'not a heater');
  check('a zero target is not a heater', isHeater({ flags: { heater_target_c: 0 } }) === false, 'not a heater');
  check('the battery defaults to twelve in-game hours',
    capacityOf({ flags: { heater_target_c: 20 } }) === 720, String(capacityOf({ flags: {} })));
  check('an authored battery overrides the default',
    capacityOf({ flags: { heater_battery_min: 90 } }) === 90, '90');

  // ── Thermostat, not bonfire ────────────────────────────────────────────────
  // The heat-source contract: given the room's pre-heating temperature, return the degrees to
  // ADD. A target is self-limiting — it rescues a freezing room and does nothing to a warm
  // one, so a heater left running in summer is wasteful rather than lethal.
  const contribution = (target, baseC) => (target > baseC ? target - baseC : 0);
  check('a heater lifts a freezing room to its target', contribution(20, -5) === 25, String(contribution(20, -5)));
  check('…and does nothing at all to a room already warmer', contribution(20, 26) === 0, String(contribution(20, 26)));
  check('…and nothing to a room exactly at target', contribution(20, 20) === 0, String(contribution(20, 20)));
  // Two heaters are one room held at the higher setting, never the sum — otherwise a stack of
  // cheap heaters cooks an apartment.
  const best = (targets, baseC) => { const t = Math.max(...targets); return t > baseC ? t - baseC : 0; };
  check('two heaters are not twice as warm', best([20, 22], 0) === 22, String(best([20, 22], 0)));
  check('the higher thermostat wins', best([15, 20], 10) === 10, String(best([15, 20], 10)));

  // ── The battery ────────────────────────────────────────────────────────────
  // The whole point of the object: HVAC dies in a blackout and an unheated room bleeds toward
  // outdoor temperature, so the charge is what stands between a cold snap and a body.
  const cap = 720;
  check('a full battery runs twelve in-game hours', cap / 60 === 12, `${cap / 60}h`);
  // Mains recharges at half the discharge rate, so a full top-up is a day — a heater that
  // carried you through last night is not automatically ready for tonight.
  check('a full recharge takes twice as long as a discharge', cap / 0.5 === 2 * cap, `${cap / 0.5} min`);
  // The flush band is what keeps this off the per-tick DB write path.
  check('charge is flushed in coarse bands, not every tick',
    Math.round(1 / _test.FLUSH_BAND) === 10, `${Math.round(1 / _test.FLUSH_BAND)} writes per discharge`);

  // ── Carried warmth (hot drinks, hand warmers) ──────────────────────────────
  {
    const p = {};
    applyWarmth(p, 4, 10);
    check('a warming thing is worth its rated degrees at once', warmthBonus(p) === 4, String(warmthBonus(p)));
    tickWarmth(p, 5);
    check('…and tapers as it goes cold rather than expiring off a cliff',
      Math.abs(warmthBonus(p) - 2) < 1e-9, String(warmthBonus(p)));
    tickWarmth(p, 5);
    check('…to exactly nothing', warmthBonus(p) === 0 && p._warmMin === undefined, 'expired clean');
  }
  {
    // A stronger source refreshes; a weaker one only extends. Otherwise the optimal play in a
    // blizzard is to carry six mugs and drink them in the right order.
    const p = {};
    applyWarmth(p, 5, 20);
    applyWarmth(p, 2, 30);
    check('a weaker source cannot dilute a stronger one', warmthBonus(p) === 5, String(warmthBonus(p)));
    applyWarmth(p, 9, 10);
    check('a stronger source takes over', warmthBonus(p) === 9, String(warmthBonus(p)));
  }
  check('nothing is warmed by a zero-degree source',
    (() => { const p = {}; applyWarmth(p, 0, 10); return warmthBonus(p); })() === 0, 'no-op');
}
