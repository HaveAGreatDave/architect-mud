// Swimming plugin regression suite — run by tests/regress.js (never loaded in
// production). Swimming has no player verbs (it's automatic on movement), so we
// exercise the pure cost math, the water-tile classifiers, and the `drowning`
// status effect the plugin registers.
import { _test } from './index.js';
import { applyEffect, tickEffects } from '../../server/engine/effects.js';

export default async function regress({ check, getPlayer }) {
  const { isSwimZone, isUnderwater, strokeCost, treadCost, BASE_STROKE, MIN_STROKE, DIVE_EXTRA } = _test;

  // ── Water-tile classifiers ──────────────────────────────────────────────────
  check('isSwimZone: painted water', isSwimZone({ flags: { terrain: 'water' } }) === true);
  check('isSwimZone: deep water flag', isSwimZone({ flags: { water: true } }) === true);
  check('isSwimZone: underwater tile', isSwimZone({ flags: { underwater: true } }) === true);
  check('isSwimZone: dry land is not swim water', isSwimZone({ flags: { terrain: 'road' } }) === false);
  check('isSwimZone: null zone safe', isSwimZone(null) === false);
  check('isUnderwater true only for the flag', isUnderwater({ flags: { underwater: true } }) === true && isUnderwater({ flags: { terrain: 'water' } }) === false);

  // ── Stroke cost scales with skill, floors, dive surcharge ───────────────────
  check('unskilled stroke costs the base', strokeCost(0) === BASE_STROKE, String(strokeCost(0)));
  check('skill makes a stroke cheaper', strokeCost(6) < strokeCost(0), `${strokeCost(6)} < ${strokeCost(0)}`);
  check('stroke never cheaper than the floor', strokeCost(999) === MIN_STROKE, String(strokeCost(999)));
  check('diving down adds the buoyancy surcharge', strokeCost(0, true) === BASE_STROKE + DIVE_EXTRA, String(strokeCost(0, true)));

  // ── Tread cost lessens with skill but never zeroes ──────────────────────────
  check('tread bleed floors at 1', treadCost(999) === 1, String(treadCost(999)));
  check('skill lessens the tread bleed', treadCost(10) <= treadCost(0), `${treadCost(10)} <= ${treadCost(0)}`);

  // ── The `drowning` status effect bleeds HP (engine tick would persist/kill) ──
  const p = getPlayer();
  const savedHp = p.hp, savedStatuses = p.statuses;
  p.hp = 100; p.hp_max = 100; p.statuses = [];
  applyEffect(p, 'drowning', 3);
  const msgs = tickEffects(p);
  check('drowning is registered and drains HP', p.hp < 100, `hp=${p.hp}`);
  check('drowning emits a warning line', msgs.some(m => /drown/i.test(m)), msgs.join(' | '));
  p.hp = savedHp; p.statuses = savedStatuses;
}
